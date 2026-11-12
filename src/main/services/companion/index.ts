import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";

import type {
  CompanionLinkStatus,
  Download,
  Game,
  GameShop,
  StartGameDownloadPayload,
} from "@types";
import {
  db,
  downloadsSublevel,
  downloadSourcesSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { appVersion, defaultDownloadsPath } from "@main/constants";
import {
  ANY_DEVICE,
  COMPANION_FILE,
  companionDeviceFile,
  getDownloadersForUri,
  getRepackUriParts,
  isFinishedRequestState,
  parseCompanionDeviceDocument,
  parseCompanionDocument,
  resolveAnyClaim,
  toInstalledRepackInfo,
  type CompanionDeviceDocument,
  type CompanionDocument,
  type CompanionLibraryGame,
  type CompanionRequest,
  type CompanionRequestStatus,
} from "@shared";

import { logger } from "../logger";
import { PersonalCloud } from "../personal-cloud";
import { WindowManager } from "../window-manager";
import { getUserPreferences } from "../user-preferences";
import { DownloadManager } from "../download";
import { pickCompanionDownload } from "./pick-download";

/** How often an open launcher looks for new requests from the phone. */
const POLL_MS = 90_000;
/** How long to wait after claiming an "any" request before trusting the claim. */
const CLAIM_SETTLE_MS = 30_000;
/** Rewrites the device file at least this often, so the phone sees it's online. */
const HEARTBEAT_MS = 15 * 60_000;
const FIRST_CHECK_DELAY_MS = 20_000;

interface LocalCompanionRecord {
  deviceId: string;
  /** Null shows the computer's own name. */
  deviceName: string | null;
  enabled: boolean;
  /** What this launcher did with each request, as last written to Drive. */
  requests: Record<string, CompanionRequestStatus & { gameKey: string }>;
  lastPublished: string | null;
  lastPublishedAt: number;
  lastCheckedAt: number | null;
}

const newRecord = (): LocalCompanionRecord => ({
  deviceId: randomUUID().replaceAll("-", "").slice(0, 16),
  deviceName: null,
  enabled: true,
  requests: {},
  lastPublished: null,
  lastPublishedAt: 0,
  lastCheckedAt: null,
});

const defaultDeviceName = () => os.hostname() || process.platform;

const isInstalled = (game: Game, download: Download | undefined) => {
  if (download) {
    return download.status === "complete" || download.status === "seeding";
  }
  return Boolean(game.executablePath);
};

const toLibraryGame = (
  game: Game,
  download: Download | undefined
): CompanionLibraryGame => {
  const entry: CompanionLibraryGame = {
    shop: game.shop,
    objectId: game.objectId,
    title: game.title,
  };
  if (isInstalled(game, download)) entry.installed = true;
  const minutes = Math.floor((game.playTimeInMilliseconds ?? 0) / 60_000);
  if (minutes > 0) entry.minutes = minutes;
  const lastPlayed = game.lastTimePlayed
    ? new Date(game.lastTimePlayed).getTime()
    : 0;
  if (lastPlayed > 0) entry.lastPlayed = lastPlayed;
  return entry;
};

const freeBytes = async (folder: string) => {
  try {
    const stats = await fs.promises.statfs(folder);
    return stats.bavail * stats.bsize;
  } catch {
    return null;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Links this launcher to the Nacho phone app through the user's Google Drive.
 * The launcher publishes a small file about itself (name, free space, library
 * list, request progress) and downloads what the phone asks for. See
 * `src/shared/companion.ts` for the files, and docs/companion-app.md.
 */
export class CompanionLink {
  private static record: LocalCompanionRecord | null = null;
  private static timer: NodeJS.Timeout | null = null;
  private static running: Promise<void> | null = null;
  private static writeQueue: Promise<void> = Promise.resolve();
  private static lastError: string | null = null;

  private static async load(): Promise<LocalCompanionRecord> {
    if (this.record) return this.record;
    const stored = await db
      .get<string, LocalCompanionRecord | null>(levelKeys.companionLink, {
        valueEncoding: "json",
      })
      .catch(() => null);
    this.record = stored?.deviceId
      ? { ...newRecord(), ...stored, requests: stored.requests ?? {} }
      : newRecord();
    if (!stored?.deviceId) await this.save(this.record);
    return this.record;
  }

  private static save(record: LocalCompanionRecord) {
    this.record = record;
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() =>
        db.put<string, LocalCompanionRecord>(levelKeys.companionLink, record, {
          valueEncoding: "json",
        })
      );
    return this.writeQueue;
  }

  public static start() {
    if (this.timer) return;
    setTimeout(() => void this.checkNow(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.checkNow(), POLL_MS);
  }

  /** Looks for requests and updates this launcher's file. One run at a time. */
  public static checkNow(): Promise<void> {
    this.running ??= this.runOnce()
      .then(() => {
        this.lastError = null;
      })
      .catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        logger.warn("[Companion] Check failed", error);
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private static async runOnce() {
    const status = await PersonalCloud.status().catch(() => null);
    if (!status?.signedIn) return;

    let record = await this.load();
    const companion = record.enabled ? await this.readCompanion() : null;

    if (companion) {
      for (const request of companion.requests) {
        if (record.requests[request.id]) continue;
        if (request.target !== record.deviceId && request.target !== ANY_DEVICE)
          continue;
        await this.takeRequest(request, companion);
        record = await this.load();
      }
      // The phone removes requests it's done with; forget them too.
      const known = new Set(companion.requests.map((request) => request.id));
      const kept = Object.fromEntries(
        Object.entries(record.requests).filter(([id]) => known.has(id))
      );
      if (Object.keys(kept).length !== Object.keys(record.requests).length) {
        record = { ...record, requests: kept };
        await this.save(record);
      }
    }

    await this.refreshProgress();
    await this.publish();
    record = await this.load();
    await this.save({ ...record, lastCheckedAt: Date.now() });
  }

  private static async readCompanion(): Promise<CompanionDocument | null> {
    const raw = await PersonalCloud.readFile(COMPANION_FILE);
    if (!raw) return null;
    try {
      return parseCompanionDocument(raw.toString("utf8"));
    } catch (error) {
      logger.warn("[Companion] Could not read the phone's file", error);
      return null;
    }
  }

  private static async readOtherDevices(
    deviceIds: string[],
    ownId: string
  ): Promise<CompanionDeviceDocument[]> {
    const devices = await Promise.all(
      deviceIds
        .filter((id) => id !== ownId)
        .map(async (id) => {
          const raw = await PersonalCloud.readFile(
            companionDeviceFile(id)
          ).catch(() => null);
          if (!raw) return null;
          try {
            return parseCompanionDeviceDocument(raw.toString("utf8"));
          } catch {
            return null;
          }
        })
    );
    return devices.filter(
      (device): device is CompanionDeviceDocument => device !== null
    );
  }

  private static async setRequest(
    id: string,
    status: CompanionRequestStatus & { gameKey: string }
  ) {
    const record = await this.load();
    await this.save({
      ...record,
      requests: { ...record.requests, [id]: status },
    });
  }

  private static async takeRequest(
    request: CompanionRequest,
    companion: CompanionDocument
  ) {
    const record = await this.load();
    const gameKey = levelKeys.game(request.shop as GameShop, request.objectId);

    if (request.target === ANY_DEVICE) {
      const others = await this.readOtherDevices(
        companion.devices,
        record.deviceId
      );
      if (resolveAnyClaim(request.id, others)) {
        await this.setRequest(request.id, {
          state: "skipped",
          at: Date.now(),
          gameKey,
        });
        return;
      }
      await this.setRequest(request.id, {
        state: "claimed",
        at: Date.now(),
        gameKey,
      });
      await this.publish(true);
      await sleep(CLAIM_SETTLE_MS);
      const latest = await this.load();
      const own = latest.requests[request.id];
      const settled = await this.readOtherDevices(
        companion.devices,
        record.deviceId
      );
      const winner = resolveAnyClaim(request.id, [
        ...settled,
        { id: record.deviceId, requests: own ? { [request.id]: own } : {} },
      ]);
      if (winner !== record.deviceId) {
        await this.setRequest(request.id, {
          state: "skipped",
          at: Date.now(),
          gameKey,
        });
        return;
      }
    }

    try {
      await this.startDownload(request);
      await this.setRequest(request.id, {
        state: "queued",
        at: Date.now(),
        progress: 0,
        gameKey,
      });
      logger.log(`[Companion] Started ${request.title} from the phone`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[Companion] Could not start ${request.title}`, error);
      await this.setRequest(request.id, {
        state: "failed",
        at: Date.now(),
        error: message,
        gameKey,
      });
    }
  }

  private static async startDownload(request: CompanionRequest) {
    const preferences = await getUserPreferences();
    const pick = pickCompanionDownload(
      request.repack,
      preferences,
      getDownloadersForUri
    );
    if (!pick) {
      throw new Error(
        "None of this listing's links can be downloaded with the services set up on this computer"
      );
    }

    const shop = request.shop as GameShop;
    const existing = await downloadsSublevel.get(
      levelKeys.game(shop, request.objectId)
    );
    if (
      existing &&
      existing.status !== "removed" &&
      existing.status !== "complete" &&
      existing.status !== "seeding"
    ) {
      throw new Error("This game is already downloading on this computer");
    }
    const game = await gamesSublevel.get(
      levelKeys.game(shop, request.objectId)
    );
    const replaceInstalledVersion = Boolean(
      game && !game.isDeleted && isInstalled(game, existing)
    );

    const payload: StartGameDownloadPayload = {
      objectId: request.objectId,
      shop,
      title: request.title,
      downloader: pick.downloader,
      downloadPath: preferences?.downloadsPath ?? defaultDownloadsPath,
      uri: pick.uri,
      parts: getRepackUriParts(request.repack, pick.uri),
      automaticallyExtract: preferences?.extractFilesByDefault ?? true,
      automaticallyDeleteArchiveFiles:
        preferences?.deleteArchiveFilesAfterExtractionByDefault ?? true,
      fileSize: request.repack.fileSize,
      repack: toInstalledRepackInfo(request.repack, pick.uri),
      replaceInstalledVersion,
    };

    // Imported here: the event modules import the services barrel.
    const busy = DownloadManager.hasActiveDownload();
    const result = busy
      ? await (
          await import("../../events/torrenting/add-game-to-queue")
        ).addGameToQueue({} as Electron.IpcMainInvokeEvent, payload)
      : await (
          await import("../../events/torrenting/start-game-download")
        ).startGameDownload({} as Electron.IpcMainInvokeEvent, payload);

    if (!result?.ok) {
      const error = (result as { error?: string } | undefined)?.error;
      throw new Error(error || "The download could not start");
    }
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  /** Moves requests along as their downloads progress on this computer. */
  private static async refreshProgress() {
    const record = await this.load();
    let changed = false;
    const requests = { ...record.requests };

    for (const [id, status] of Object.entries(requests)) {
      if (isFinishedRequestState(status.state) || status.state === "claimed")
        continue;
      const download = await downloadsSublevel
        .get(status.gameKey)
        .catch(() => undefined);

      let next: CompanionRequestStatus | null = null;
      if (!download || download.status === "removed") {
        next = { state: "cancelled", at: Date.now() };
      } else if (
        (download.status === "complete" || download.status === "seeding") &&
        !download.extracting
      ) {
        next = { state: "done", at: Date.now() };
      } else if (download.status === "error") {
        next = { state: "failed", at: Date.now(), error: "Download failed" };
      } else {
        const state = download.status === "active" ? "downloading" : "queued";
        const progress = Math.round((download.progress ?? 0) * 100) / 100;
        if (state !== status.state || progress !== status.progress) {
          next = {
            state,
            at: state !== status.state ? Date.now() : status.at,
            progress,
          };
        }
      }

      if (next) {
        requests[id] = { ...next, gameKey: status.gameKey };
        changed = true;
      }
    }

    if (changed) await this.save({ ...record, requests });
  }

  private static async buildDeviceDocument(
    record: LocalCompanionRecord
  ): Promise<CompanionDeviceDocument> {
    const preferences = await getUserPreferences();
    const downloadPath = preferences?.downloadsPath ?? defaultDownloadsPath;
    const [games, downloads, sources] = await Promise.all([
      gamesSublevel.values().all(),
      downloadsSublevel.iterator().all(),
      downloadSourcesSublevel.values().all(),
    ]);
    const downloadByKey = new Map(downloads);

    const library = games
      .filter(
        (game) =>
          !game.isDeleted && game.shop !== "custom" && game.source !== "epic"
      )
      .map((game) =>
        toLibraryGame(
          game,
          downloadByKey.get(levelKeys.game(game.shop, game.objectId))
        )
      )
      .sort((a, b) => a.title.localeCompare(b.title));

    return {
      version: 1,
      id: record.deviceId,
      name: record.deviceName || defaultDeviceName(),
      platform: process.platform,
      appVersion,
      lastSeen: Date.now(),
      acceptsRequests: record.enabled,
      downloadPath,
      freeBytes: await freeBytes(downloadPath),
      sources: sources.map((source) => ({ id: source.id, name: source.name })),
      library,
      requests: Object.fromEntries(
        Object.entries(record.requests).map(
          ([id, { gameKey: _, ...status }]) => [id, status]
        )
      ),
    };
  }

  /**
   * Writes this launcher's file when something the phone shows changed, or
   * when it hasn't been written for a while.
   */
  private static async publish(force = false) {
    const record = await this.load();
    const document = await this.buildDeviceDocument(record);
    const { lastSeen: _, freeBytes: __, ...comparable } = document;
    const fingerprint = JSON.stringify(comparable);
    const stale = Date.now() - record.lastPublishedAt > HEARTBEAT_MS;
    if (!force && !stale && fingerprint === record.lastPublished) return;

    await PersonalCloud.writeFile(
      companionDeviceFile(record.deviceId),
      Buffer.from(JSON.stringify(document))
    );
    const latest = await this.load();
    await this.save({
      ...latest,
      lastPublished: fingerprint,
      lastPublishedAt: Date.now(),
    });
  }

  public static async getStatus(): Promise<CompanionLinkStatus> {
    const record = await this.load();
    const status = await PersonalCloud.status().catch(() => null);
    return {
      enabled: record.enabled,
      signedIn: status?.signedIn ?? false,
      deviceId: record.deviceId,
      deviceName: record.deviceName || defaultDeviceName(),
      lastCheckedAt: record.lastCheckedAt,
      lastError: this.lastError,
    };
  }

  public static async setEnabled(enabled: boolean) {
    const record = await this.load();
    await this.save({ ...record, enabled });
    await this.checkNow();
    return this.getStatus();
  }

  public static async setDeviceName(name: string) {
    const record = await this.load();
    const trimmed = name.trim().slice(0, 60);
    await this.save({ ...record, deviceName: trimmed || null });
    await this.checkNow();
    return this.getStatus();
  }
}
