import { Notification } from "electron";
import { t } from "i18next";

import {
  downloadsSublevel,
  downloadSourcesSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import {
  DownloadError,
  Downloader,
  findGameUpdate,
  findRepackByUri,
  toInstalledRepackInfo,
  type GameUpdateInfo,
  type InstalledRepackInfo,
} from "@shared";
import type { Download, Game, GameRepack } from "@types";
import { deleteGameFiles } from "@main/events/library/delete-game-folder";

import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { updateGameRecord } from "./game-record-updater";
import { isGameRunning } from "./game-running-state";
import { PersonalCloud } from "./personal-cloud";
import { LocalNotificationManager } from "./notifications/local-notifications";

const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DELAY_BETWEEN_GAMES_MS = 500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const catalogueIdentity = (game: Game) =>
  game.catalogueGame ?? { shop: game.shop, objectId: game.objectId };

/**
 * Watches the download sources installed games came from and flags a game
 * when its source lists a newer version, so it can be updated in place.
 */
export class GameUpdates {
  private static timer: NodeJS.Timeout | null = null;
  private static checking: Promise<void> | null = null;

  public static start() {
    if (this.timer) return;
    setTimeout(() => void this.checkAll(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.checkAll(), CHECK_INTERVAL_MS);
  }

  private static async fetchRepacks(game: Game, downloadSourceIds: string[]) {
    const { shop, objectId } = catalogueIdentity(game);
    const repacks = await HydraApi.get<GameRepack[]>(
      `/games/${shop}/${objectId}/download-sources`,
      { take: 100, skip: 0, downloadSourceIds },
      { needsAuth: false }
    );
    return Array.isArray(repacks) ? repacks : [];
  }

  /** Works out which listing an older install came from, by its link. */
  private static async findInstalledRepack(
    game: Game,
    download: Download | undefined,
    sourceIds: string[]
  ): Promise<InstalledRepackInfo | null> {
    if (game.installedRepack) return game.installedRepack;
    if (!download?.uri) return null;

    const repacks = await this.fetchRepacks(game, sourceIds);
    const repack = findRepackByUri(repacks, download.uri);
    if (!repack) return null;

    const installedRepack = toInstalledRepackInfo(repack, download.uri);
    await updateGameRecord(levelKeys.game(game.shop, game.objectId), {
      installedRepack,
    });
    return installedRepack;
  }

  private static isInstalled(game: Game, download: Download | undefined) {
    if (game.isDeleted || game.shop === "custom") return false;
    if (download?.downloader === Downloader.Epic) return false;
    if (download) {
      return download.status === "complete" || download.status === "seeding";
    }
    return Boolean(game.installedRepack && game.executablePath);
  }

  /** Checks one game and returns the update it found, if it's a new one. */
  private static async checkGame(
    game: Game,
    sourceIds: string[]
  ): Promise<GameUpdateInfo | null> {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    const download = await downloadsSublevel.get(gameKey).catch(() => null);
    if (!this.isInstalled(game, download ?? undefined)) return null;

    const installed = await this.findInstalledRepack(
      game,
      download ?? undefined,
      sourceIds
    );
    if (!installed || !sourceIds.includes(installed.downloadSourceId)) {
      return null;
    }

    const repacks = await this.fetchRepacks(game, [installed.downloadSourceId]);
    const repack = findGameUpdate(installed, repacks);

    if (!repack || repack.id === game.skippedUpdateRepackId) {
      if (game.availableUpdate) {
        await updateGameRecord(gameKey, { availableUpdate: null });
      }
      return null;
    }

    if (game.availableUpdate?.id === repack.id) return null;

    const update: GameUpdateInfo = {
      ...toInstalledRepackInfo(repack),
      fileSize: repack.fileSize,
      detectedAt: new Date().toISOString(),
    };
    await updateGameRecord(gameKey, { availableUpdate: update });
    return update;
  }

  public static checkAll(): Promise<void> {
    this.checking ??= (async () => {
      try {
        const sources = await downloadSourcesSublevel.values().all();
        const sourceIds = sources.map((source) => source.id);
        if (sourceIds.length === 0) return;

        const games = await gamesSublevel.values().all();
        let changed = false;

        for (const game of games) {
          try {
            const update = await this.checkGame(game, sourceIds);
            if (update) {
              changed = true;
              logger.info("[Game Updates] Newer version found", {
                shop: game.shop,
                objectId: game.objectId,
                installed: game.installedRepack?.title,
                available: update.title,
              });
              await this.notify(game, update);
            }
          } catch (error) {
            logger.warn("[Game Updates] Check failed", {
              shop: game.shop,
              objectId: game.objectId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          await wait(DELAY_BETWEEN_GAMES_MS);
        }

        if (changed) {
          WindowManager.sendToAppWindows("on-library-batch-complete");
        }
      } catch (error) {
        logger.error("[Game Updates] Check failed", error);
      } finally {
        this.checking = null;
      }
    })();
    return this.checking;
  }

  private static async notify(game: Game, update: GameUpdateInfo) {
    const title = t("game_update_available", {
      ns: "notifications",
      title: game.title,
    });
    const body = t("game_update_available_description", {
      ns: "notifications",
      version: update.title,
      source: update.downloadSourceName,
    });
    const url = `/game/${game.shop}/${game.objectId}`;

    new Notification({ title, body })
      .on("click", () => {
        WindowManager.redirect(url);
      })
      .show();

    await LocalNotificationManager.createNotification(
      "GAME_UPDATE_AVAILABLE",
      title,
      body,
      { pictureUrl: game.iconUrl, url }
    );
  }

  /** Stops offering this version. A later one is still offered. */
  public static async skipUpdate(shop: Game["shop"], objectId: string) {
    await updateGameRecord(levelKeys.game(shop, objectId), (game) => ({
      skippedUpdateRepackId: game.availableUpdate?.id ?? null,
      availableUpdate: null,
    }));
  }

  /**
   * Backs up the game's saves to Google Drive, then removes the installed
   * version's files so the new one can be downloaded in its place. Saves
   * that live outside the game folder are never touched.
   */
  public static async removeInstalledVersion(
    shop: Game["shop"],
    objectId: string
  ) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    if (isGameRunning(objectId, shop)) {
      throw new Error(DownloadError.UpdateGameRunning);
    }

    if (game.executablePath && (await PersonalCloud.isSyncing())) {
      try {
        const result = await PersonalCloud.syncNow(shop, objectId);
        logger.info("[Game Updates] Saves backed up before update", {
          shop,
          objectId,
          result,
        });
      } catch (error) {
        logger.error("[Game Updates] Save backup failed, not updating", error);
        throw new Error(DownloadError.UpdateSaveBackupFailed);
      }
    }

    const download = await downloadsSublevel.get(gameKey).catch(() => null);
    if (download) {
      await deleteGameFiles(shop, objectId, { deleteSourceArchive: true });
    }
  }

  /** Remembers which listing a new download came from. */
  public static async recordInstalledRepack(
    shop: Game["shop"],
    objectId: string,
    repack: InstalledRepackInfo
  ) {
    await updateGameRecord(levelKeys.game(shop, objectId), {
      installedRepack: repack,
      availableUpdate: null,
      skippedUpdateRepackId: null,
    });
  }
}
