import os from "node:os";
import { randomUUID } from "node:crypto";

import type {
  AchievementSyncStatus,
  GameShop,
  SettingsSyncError,
  UnlockedAchievement,
} from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";

import { logger } from "../logger";
import { PersonalCloud } from "../personal-cloud";
import { WindowManager } from "../window-manager";
import { describeSettingsSyncError } from "../settings-sync/sync-error";
import {
  mergeSyncedAchievements,
  parseAchievementDocument,
  toAchievementDocument,
  toSyncedGame,
  type SyncedAchievements,
} from "./achievement-document";
import { SyncedUnlocksStore } from "./synced-unlocks-store";

export { SyncedUnlocksStore } from "./synced-unlocks-store";

const ACHIEVEMENTS_FILE = "hydra/achievements.json";
const PUSH_DELAY_MS = 10_000;
const PERIODIC_SYNC_MS = 15 * 60_000;

interface LocalAchievementRecord {
  deviceId: string;
  lastSyncedAt: number | null;
  /** Unlocks this device knows about, its own and other devices'. */
  games: SyncedAchievements;
  /** True when `games` has unlocks Drive may not have yet. */
  dirty: boolean;
}

const newRecord = (): LocalAchievementRecord => ({
  deviceId: `${os.hostname() || process.platform}-${randomUUID().slice(0, 8)}`,
  lastSyncedAt: null,
  games: {},
  dirty: false,
});

const splitGameKey = (key: string): [GameShop, string] | null => {
  const separator = key.indexOf(":");
  if (separator <= 0) return null;
  return [key.slice(0, separator) as GameShop, key.slice(separator + 1)];
};

/**
 * Syncs unlocked achievements through the user's Google Drive, using the
 * Google sign-in shared with cloud saves and settings sync. Unlocks from every
 * device are merged: once unlocked anywhere, an achievement shows as unlocked
 * everywhere, at the earliest time any device saw it. The file is
 * `hydra/achievements.json`.
 */
export class AchievementSync {
  private static record: LocalAchievementRecord | null = null;
  private static loading: Promise<LocalAchievementRecord> | null = null;
  private static running: Promise<void> | null = null;
  private static rerun = false;
  private static pushTimer: NodeJS.Timeout | null = null;
  private static periodicTimer: NodeJS.Timeout | null = null;
  private static lastError: SettingsSyncError | null = null;
  private static writeQueue: Promise<void> = Promise.resolve();

  private static load(): Promise<LocalAchievementRecord> {
    if (this.record) return Promise.resolve(this.record);
    this.loading ??= (async () => {
      const stored = await db
        .get<string, LocalAchievementRecord | null>(levelKeys.achievementSync, {
          valueEncoding: "json",
        })
        .catch(() => null);
      const record: LocalAchievementRecord = stored?.deviceId
        ? { ...newRecord(), ...stored, games: stored.games ?? {} }
        : newRecord();
      this.record = record;
      SyncedUnlocksStore.replace(record.games);
      return record;
    })();
    return this.loading;
  }

  /** Saves the record, one write at a time so an older one never lands last. */
  private static save(record: LocalAchievementRecord) {
    this.record = record;
    SyncedUnlocksStore.replace(record.games);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() =>
        db.put<string, LocalAchievementRecord>(
          levelKeys.achievementSync,
          record,
          { valueEncoding: "json" }
        )
      );
    return this.writeQueue;
  }

  /**
   * Notes a game's unlocks on this device, and uploads them shortly after if
   * any are new. Called whenever Hydra merges achievements for a game.
   */
  public static async recordLocal(
    shop: GameShop,
    objectId: string,
    unlocked: UnlockedAchievement[]
  ) {
    if (shop === "epic" || shop === "custom") return;
    const game = toSyncedGame(unlocked);
    if (Object.keys(game).length === 0) return;

    const record = await this.load();
    const key = levelKeys.game(shop, objectId);
    const { merged, changedGames } = mergeSyncedAchievements(record.games, {
      [key]: game,
    });
    if (changedGames.length === 0) return;

    await this.save({ ...record, games: merged, dirty: true });
    this.scheduleSync();
  }

  private static async runOnce() {
    const record = await this.load();
    const status = await PersonalCloud.status().catch(() => null);
    if (!status?.signedIn) return;

    const raw = await PersonalCloud.readFile(ACHIEVEMENTS_FILE);
    let remote: SyncedAchievements = {};
    if (raw) {
      try {
        remote = parseAchievementDocument(raw.toString("utf8"));
      } catch (error) {
        // A broken file is replaced by this device's copy below.
        logger.warn("Achievement sync could not read the Drive file", error);
      }
    }

    // Re-read: unlocks may have come in while Drive was being read.
    const latest = this.record ?? record;
    const fromRemote = mergeSyncedAchievements(latest.games, remote);
    const fromLocal = mergeSyncedAchievements(remote, latest.games);
    const now = Date.now();

    if (!raw || fromLocal.changedGames.length > 0) {
      const document = toAchievementDocument(
        fromRemote.merged,
        now,
        latest.deviceId
      );
      await PersonalCloud.writeFile(
        ACHIEVEMENTS_FILE,
        Buffer.from(JSON.stringify(document))
      );
    }

    const current = this.record ?? latest;
    const { merged } = mergeSyncedAchievements(
      current.games,
      fromRemote.merged
    );
    await this.save({
      ...current,
      games: merged,
      lastSyncedAt: now,
      dirty: false,
    });

    if (fromRemote.changedGames.length > 0) {
      logger.info(
        `Achievement sync brought in unlocks for ${fromRemote.changedGames.length} game(s)`
      );
      await this.refreshGames(fromRemote.changedGames);
    }
  }

  /** Shows unlocks from other devices on open game pages and library cards. */
  private static async refreshGames(gameKeys: string[]) {
    const [{ UnlockedAchievementsCache }, { getUnlockedAchievements }] =
      await Promise.all([
        import("../achievements/unlocked-achievements-cache"),
        import("@main/events/user/get-unlocked-achievements"),
      ]);

    for (const key of gameKeys) {
      const parts = splitGameKey(key);
      if (!parts) continue;
      const [shop, objectId] = parts;
      const game = await gamesSublevel.get(key).catch(() => null);
      if (!game || game.isDeleted) continue;

      UnlockedAchievementsCache.invalidate(shop, objectId);
      const achievements = await getUnlockedAchievements(
        objectId,
        shop,
        true
      ).catch(() => null);
      if (!achievements) continue;

      WindowManager.mainWindow?.webContents.send(
        `on-update-achievements-${objectId}-${shop}`,
        achievements
      );
    }

    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  /** Pulls and pushes now. Concurrent calls share one run, plus one rerun. */
  public static syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }

    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          this.notify(true);
          await this.runOnce();
          this.lastError = null;
        } while (this.rerun);
      } catch (error) {
        this.lastError = describeSettingsSyncError(error);
        logger.error(
          `Achievement sync failed (${this.lastError.reason})`,
          error
        );
      } finally {
        this.running = null;
        this.notify(false);
      }
    })();

    return this.running;
  }

  /** Uploads a few seconds after an unlock, so a burst is one upload. */
  public static scheduleSync() {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.syncNow();
    }, PUSH_DELAY_MS);
  }

  /** Loads synced unlocks, then syncs on launch and periodically. */
  public static async start() {
    await this.load().catch((error) =>
      logger.error("Achievement sync could not load its local copy", error)
    );
    void this.syncNow();
    this.periodicTimer ??= setInterval(
      () => void this.syncNow(),
      PERIODIC_SYNC_MS
    );
  }

  public static async getStatus(): Promise<AchievementSyncStatus> {
    const [record, status] = await Promise.all([
      this.load(),
      PersonalCloud.status().catch(() => null),
    ]);
    return {
      signedIn: status?.signedIn ?? false,
      syncing: this.running !== null,
      lastSyncedAt: record.lastSyncedAt,
      pendingUpload: record.dirty,
      lastError: this.lastError,
    };
  }

  private static notify(syncing: boolean) {
    void this.getStatus()
      .then((status) =>
        WindowManager.sendToAppWindows("on-achievement-sync-status", {
          ...status,
          syncing,
        })
      )
      .catch(() => undefined);
  }
}
