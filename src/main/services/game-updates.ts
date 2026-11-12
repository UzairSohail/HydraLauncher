import fs from "node:fs";
import path from "node:path";
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
import {
  findSourceArchiveFile,
  listArchiveVolumes,
} from "@main/helpers/find-game-installer";

import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { updateGameRecord } from "./game-record-updater";
import { isGameRunning } from "./game-running-state";
import { PersonalCloud } from "./personal-cloud";
import { LocalNotificationManager } from "./notifications/local-notifications";

const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DELAY_BETWEEN_GAMES_MS = 500;

const PREVIOUS_SUFFIX = " (previous version)";

const isInside = (target: string, folder: string) => {
  const relative = path.relative(folder, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

/** Re-points a path inside `from` to the same place inside `to`. */
const moveInto = (
  target: string | null | undefined,
  from: string | null,
  to: string | null
) => {
  if (!target) return null;
  if (!from || !to || !isInside(target, from)) return target;
  return path.join(to, path.relative(from, target));
};

/** The path itself, or the path with a number added when it's taken. */
const freePath = async (target: string) => {
  let candidate = target;
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = `${target} ${n}`;
  }
  return candidate;
};

const deleteSourceArchives = async (download: Download) => {
  const archive = await findSourceArchiveFile(download).catch(() => null);
  if (!archive) return;
  const volumes = await listArchiveVolumes(archive).catch(() => []);
  await Promise.all(
    volumes.map((volume) =>
      fs.promises
        .rm(volume, { force: true })
        .catch((error) =>
          logger.error("[Game Updates] Could not remove old archive", error)
        )
    )
  );
};

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
        const found: { game: Game; update: GameUpdateInfo }[] = [];

        for (const game of games) {
          try {
            const update = await this.checkGame(game, sourceIds);
            if (update) {
              found.push({ game, update });
              logger.info("[Game Updates] Newer version found", {
                shop: game.shop,
                objectId: game.objectId,
                installed: game.installedRepack?.title,
                available: update.title,
              });
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

        if (found.length > 0) {
          WindowManager.sendToAppWindows("on-library-batch-complete");
          await this.notify(found);
        }
      } catch (error) {
        logger.error("[Game Updates] Check failed", error);
      } finally {
        this.checking = null;
      }
    })();
    return this.checking;
  }

  /**
   * Adds each update to the in-app notifications, but shows a single desktop
   * notification for the whole check so several updates don't pile up.
   */
  private static async notify(found: { game: Game; update: GameUpdateInfo }[]) {
    for (const { game, update } of found) {
      await LocalNotificationManager.createNotification(
        "GAME_UPDATE_AVAILABLE",
        t("game_update_available", {
          ns: "notifications",
          title: game.title,
        }),
        t("game_update_available_description", {
          ns: "notifications",
          version: update.title,
          source: update.downloadSourceName,
        }),
        {
          pictureUrl: game.iconUrl,
          url: `/game/${game.shop}/${game.objectId}`,
        }
      );
    }

    if (found.length === 1) {
      const [{ game, update }] = found;
      const url = `/game/${game.shop}/${game.objectId}`;
      new Notification({
        title: t("game_update_available", {
          ns: "notifications",
          title: game.title,
        }),
        body: t("game_update_available_description", {
          ns: "notifications",
          version: update.title,
          source: update.downloadSourceName,
        }),
      })
        .on("click", () => WindowManager.redirect(url))
        .show();
      return;
    }

    new Notification({
      title: t("game_updates_available", {
        ns: "notifications",
        count: found.length,
      }),
      body: found.map(({ game }) => game.title).join(", "),
    })
      .on("click", () => WindowManager.redirect("/library"))
      .show();
  }

  /** The listing for the update a game has waiting, if it's still listed. */
  public static async getUpdateRepack(
    shop: Game["shop"],
    objectId: string
  ): Promise<GameRepack | null> {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    const update = game?.availableUpdate;
    if (!game || !update) return null;
    const repacks = await this.fetchRepacks(game, [update.downloadSourceId]);
    return repacks.find((repack) => repack.id === update.id) ?? null;
  }

  /** Stops offering this version. A later one is still offered. */
  public static async skipUpdate(shop: Game["shop"], objectId: string) {
    await updateGameRecord(levelKeys.game(shop, objectId), (game) => ({
      skippedUpdateRepackId: game.availableUpdate?.id ?? null,
      availableUpdate: null,
    }));
  }

  /**
   * Backs up the game's saves to Google Drive, then moves the installed
   * version's folder aside so the new one can be downloaded without touching
   * it. The old version stays playable until the new one has finished, and
   * comes back if the update is cancelled. Saves that live outside the game
   * folder are never touched.
   */
  public static async setAsideInstalledVersion(
    shop: Game["shop"],
    objectId: string
  ): Promise<boolean> {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) return false;

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

    // An earlier update that never finished already holds the version that
    // is actually playable, so keep that one.
    if (game.previousInstall) return false;

    const download = await downloadsSublevel.get(gameKey).catch(() => null);
    const originalFolderPath =
      download?.folderName && download.downloadPath
        ? path.join(download.downloadPath, download.folderName)
        : null;

    let folderPath: string | null = null;
    if (originalFolderPath && fs.existsSync(originalFolderPath)) {
      folderPath = await freePath(`${originalFolderPath}${PREVIOUS_SUFFIX}`);
      await fs.promises.rename(originalFolderPath, folderPath);
      // The old archive isn't needed to play, and a new archive with the
      // same name would otherwise look already downloaded.
      await deleteSourceArchives(download!);
    }

    await updateGameRecord(gameKey, (current) => ({
      previousInstall: {
        folderPath,
        originalFolderPath,
        download: download ?? null,
        installedRepack: current.installedRepack ?? null,
        executablePath: current.executablePath ?? null,
      },
      executablePath: moveInto(
        current.executablePath,
        originalFolderPath,
        folderPath
      ),
    }));
    logger.info("[Game Updates] Kept the installed version aside", {
      shop,
      objectId,
      folderPath,
    });
    return true;
  }

  /**
   * Once the new version is in place, removes the old one and points the
   * game at the new files. Waits while the old version is being played.
   */
  public static async finishUpdate(shop: Game["shop"], objectId: string) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const previous = game?.previousInstall;
    if (!game || !previous) return;
    if (isGameRunning(objectId, shop)) return;

    const download = await downloadsSublevel.get(gameKey).catch(() => null);
    const newFolderPath =
      download?.folderName && download.downloadPath
        ? path.join(download.downloadPath, download.folderName)
        : null;

    if (previous.folderPath && previous.folderPath !== newFolderPath) {
      await fs.promises
        .rm(previous.folderPath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        })
        .catch((error) =>
          logger.error("[Game Updates] Could not remove the old version", error)
        );
    }

    await updateGameRecord(gameKey, (current) => {
      const executableWasMoved =
        previous.folderPath !== null &&
        current.executablePath !== null &&
        current.executablePath !== undefined &&
        isInside(current.executablePath, previous.folderPath);

      let executablePath = current.executablePath ?? null;
      if (executableWasMoved) {
        // Same file name in the new version's folder, when it has one.
        const candidate = moveInto(
          current.executablePath,
          previous.folderPath,
          newFolderPath
        );
        executablePath =
          candidate &&
          candidate !== current.executablePath &&
          fs.existsSync(candidate)
            ? candidate
            : null;
      }

      return { previousInstall: null, executablePath };
    });
    logger.info("[Game Updates] Update finished", { shop, objectId });
  }

  /** Puts the old version back when its update is cancelled. */
  public static async restorePreviousVersion(
    shop: Game["shop"],
    objectId: string
  ) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const previous = game?.previousInstall;
    if (!game || !previous) return;

    let restoredFolderPath = previous.folderPath;
    if (
      previous.folderPath &&
      previous.originalFolderPath &&
      fs.existsSync(previous.folderPath) &&
      !fs.existsSync(previous.originalFolderPath)
    ) {
      await fs.promises
        .rename(previous.folderPath, previous.originalFolderPath)
        .then(() => {
          restoredFolderPath = previous.originalFolderPath;
        })
        .catch((error) =>
          logger.error(
            "[Game Updates] Could not move the old version back",
            error
          )
        );
    }

    if (previous.download) {
      await downloadsSublevel.put(gameKey, {
        ...previous.download,
        folderName:
          restoredFolderPath && previous.download.downloadPath
            ? path.relative(previous.download.downloadPath, restoredFolderPath)
            : previous.download.folderName,
        queued: false,
        pinnedToHero: false,
      });
    }

    await updateGameRecord(gameKey, {
      previousInstall: null,
      installedRepack: previous.installedRepack,
      executablePath: moveInto(
        previous.executablePath,
        previous.originalFolderPath,
        restoredFolderPath
      ),
    });
    WindowManager.sendDownloadsUpdated();
    logger.info("[Game Updates] Update cancelled, old version restored", {
      shop,
      objectId,
    });
  }

  /** Finishes updates that completed while their old version was running. */
  public static async finishCompletedUpdates() {
    const games = await gamesSublevel.values().all();
    for (const game of games) {
      if (!game.previousInstall) continue;
      const download = await downloadsSublevel
        .get(levelKeys.game(game.shop, game.objectId))
        .catch(() => null);
      if (download?.status === "complete" && !download.extracting) {
        try {
          await this.finishUpdate(game.shop, game.objectId);
          const { GameFilesManager } = await import("./game-files-manager");
          await new GameFilesManager(
            game.shop,
            game.objectId
          ).searchAndBindExecutable();
        } catch (error) {
          logger.error("[Game Updates] Could not finish update", error);
        }
      }
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
