import path from "node:path";

import { shell } from "electron";

import { gamesSublevel, levelKeys } from "@main/level";
import type {
  Game,
  GameShop,
  PersonalCloudGameState,
  PersonalCloudLinkResult,
  PersonalCloudStatus,
  PersonalCloudSyncEvent,
  PersonalCloudSyncResult,
} from "@types";

import { isGameRunning } from "../game-running-state";
import { logger } from "../logger";
import { NativeAddon } from "../native-addon";
import { Wine } from "../wine";
import { WindowManager } from "../window-manager";

import {
  getPersonalCloudLinkInput,
  PRE_LAUNCH_SYNC_TIMEOUT_MS,
  PRE_LAUNCH_TIMEOUT_ERROR,
} from "./policy";

export * from "./policy";

const native = () => NativeAddon.personalCloud();

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Cloud saves through Cloud Save Manager. Hydra shares this device's Google
 * sign-in, catalogue and sync state with the Cloud Save Manager app, so saves
 * made through Hydra show up on the user's other devices, and the reverse.
 */
export class PersonalCloud {
  /** Hydra game key to Cloud Save Manager game id, linked this session. */
  private static links = new Map<string, { exePath: string; gameId: string }>();
  private static startedAt = new Map<string, number>();
  private static signingIn: Promise<PersonalCloudStatus> | null = null;
  private static pulling = new Set<string>();

  public static status(): Promise<PersonalCloudStatus> {
    return native().personalCloudStatus();
  }

  /** Opens Google sign-in in the browser and waits for it to finish. */
  public static signIn(): Promise<PersonalCloudStatus> {
    this.signingIn ??= (async () => {
      try {
        const url = await native().personalCloudBeginSignIn();
        await shell.openExternal(url);
        await native().personalCloudFinishSignIn();
        return await this.status();
      } finally {
        this.signingIn = null;
      }
    })();
    return this.signingIn;
  }

  public static async setPaused(paused: boolean) {
    await native().personalCloudSetPaused(paused);
    return this.status();
  }

  private static async linkGame(
    game: Game
  ): Promise<PersonalCloudLinkResult | null> {
    const input = getPersonalCloudLinkInput(game, {
      platform: process.platform,
      winePrefixPath:
        process.platform === "linux"
          ? Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
          : null,
    });
    if (!input) return null;
    const key = levelKeys.game(game.shop, game.objectId);
    const cached = this.links.get(key);
    // Re-linking also picks up a catalogue entry another device added.
    const result = await native().personalCloudLinkGame(input);
    if (cached?.gameId !== result.gameId) {
      logger.info("[Personal Cloud] Linked game", {
        shop: game.shop,
        objectId: game.objectId,
        gameId: result.gameId,
        inCatalogue: result.inCatalogue,
      });
    }
    this.links.set(key, { exePath: input.exePath, gameId: result.gameId });
    return result;
  }

  private static async getGame(shop: GameShop, objectId: string) {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    if (!game) throw new Error("Game not found");
    return game;
  }

  private static async requireGameId(shop: GameShop, objectId: string) {
    const game = await this.getGame(shop, objectId);
    const link = await this.linkGame(game);
    if (!link) throw new Error("Choose the game's executable first");
    return link.gameId;
  }

  public static async getGameState(
    shop: GameShop,
    objectId: string
  ): Promise<PersonalCloudGameState> {
    const status = await this.status();
    if (!status.signedIn) return { status, info: null };
    const game = await this.getGame(shop, objectId);
    const link = await this.linkGame(game);
    if (!link) return { status, info: null };
    const info = await native().personalCloudGameInfo(link.gameId);
    if (info.status === "cloud_newer" && !status.paused) {
      void this.pullNewerSave(game);
    }
    return { status, info };
  }

  /**
   * Downloads a newer cloud save as soon as Nacho notices it, so the game is
   * already up to date before it's launched. Never while the game is running.
   */
  private static async pullNewerSave(game: Game) {
    const key = levelKeys.game(game.shop, game.objectId);
    if (this.pulling.has(key) || isGameRunning(game.objectId, game.shop)) {
      return;
    }
    this.pulling.add(key);
    try {
      await this.runSync(game, "auto", (gameId) =>
        native().personalCloudSync(gameId, false)
      );
    } finally {
      this.pulling.delete(key);
    }
  }

  private static notify(event: PersonalCloudSyncEvent) {
    WindowManager.sendToAppWindows("on-personal-cloud-sync", event);
  }

  private static async runSync(
    game: Game,
    phase: PersonalCloudSyncEvent["phase"],
    work: (gameId: string) => Promise<PersonalCloudSyncResult>
  ): Promise<PersonalCloudSyncResult | null> {
    const base = { shop: game.shop, objectId: game.objectId, phase };
    try {
      if (!(await this.status()).signedIn) return null;
      const link = await this.linkGame(game);
      if (!link) return null;
      const result = await work(link.gameId);
      logger.info("[Personal Cloud] Sync finished", { ...base, ...result });
      this.notify({ ...base, result, error: null });
      return result;
    } catch (error) {
      logger.error("[Personal Cloud] Sync failed", {
        ...base,
        error: errorMessage(error),
      });
      this.notify({ ...base, result: null, error: errorMessage(error) });
      return null;
    }
  }

  /**
   * Pulls a newer save from the cloud before the game starts. It never blocks
   * the launch: a failure or a slow connection just starts the game.
   */
  public static async syncBeforeLaunch(game: Game) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        logger.warn("[Personal Cloud] Pre-launch sync is slow, starting game", {
          shop: game.shop,
          objectId: game.objectId,
        });
        this.notify({
          shop: game.shop,
          objectId: game.objectId,
          phase: "pre-launch",
          result: null,
          error: PRE_LAUNCH_TIMEOUT_ERROR,
        });
        resolve(null);
      }, PRE_LAUNCH_SYNC_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        this.runSync(game, "pre-launch", (gameId) =>
          native().personalCloudSync(gameId, false)
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Marks the game as playing, so the Cloud Save Manager app leaves it alone. */
  public static async onGameStarted(game: Game) {
    const key = levelKeys.game(game.shop, game.objectId);
    if (!this.startedAt.has(key)) this.startedAt.set(key, Date.now());
    try {
      if (!(await this.status()).signedIn) return;
      const link = await this.linkGame(game);
      if (link) native().personalCloudPlayingStart(link.gameId);
    } catch (error) {
      logger.error("[Personal Cloud] Couldn't mark the game as playing", {
        shop: game.shop,
        objectId: game.objectId,
        error: errorMessage(error),
      });
    }
  }

  /**
   * Uploads the session's saves once the game exits. A game Cloud Save Manager
   * doesn't know yet has its saves found from what changed while playing.
   */
  public static async onGameClosed(game: Game) {
    const key = levelKeys.game(game.shop, game.objectId);
    const startedAt = this.startedAt.get(key) ?? Date.now();
    this.startedAt.delete(key);
    const cached = this.links.get(key);
    if (cached) {
      try {
        native().personalCloudPlayingStop(cached.gameId);
      } catch (error) {
        logger.error("[Personal Cloud] Couldn't clear the playing marker", {
          error: errorMessage(error),
        });
      }
    }
    return this.runSync(game, "post-exit", async (gameId) => {
      const result = await native().personalCloudSync(gameId, true);
      if (result.outcome !== "not_in_catalogue") return result;
      return native().personalCloudLearnAfterPlay(gameId, startedAt);
    });
  }

  public static async syncNow(shop: GameShop, objectId: string) {
    const gameId = await this.requireGameId(shop, objectId);
    const result = await native().personalCloudSync(gameId, false);
    this.notify({ shop, objectId, phase: "manual", result, error: null });
    return result;
  }

  public static async forceUpload(shop: GameShop, objectId: string) {
    return native().personalCloudForceUpload(
      await this.requireGameId(shop, objectId)
    );
  }

  public static async forceDownload(shop: GameShop, objectId: string) {
    return native().personalCloudForceDownload(
      await this.requireGameId(shop, objectId)
    );
  }

  public static async restoreVersion(
    shop: GameShop,
    objectId: string,
    versionId: string
  ) {
    return native().personalCloudRestoreVersion(
      await this.requireGameId(shop, objectId),
      versionId
    );
  }

  public static async deleteVersion(
    shop: GameShop,
    objectId: string,
    versionId: string
  ) {
    return native().personalCloudDeleteVersion(
      await this.requireGameId(shop, objectId),
      versionId
    );
  }

  /** Starts syncing a game from a save folder the user picked. */
  public static async useSaveFolder(
    shop: GameShop,
    objectId: string,
    folder: string
  ) {
    const game = await this.getGame(shop, objectId);
    const gameId = await this.requireGameId(shop, objectId);
    await native().personalCloudAdoptGame(
      gameId,
      game.title || path.basename(folder),
      folder
    );
    return this.syncNow(shop, objectId);
  }

  /** Reads one of Hydra's own files in the Drive folder, under `hydra/`. */
  public static readFile(key: string) {
    return native().personalCloudReadFile(key);
  }

  public static writeFile(key: string, data: Buffer) {
    return native().personalCloudWriteFile(key, data);
  }
}
