import os from "node:os";
import { randomUUID } from "node:crypto";

import { safeStorage } from "electron";

import type {
  SettingsSyncError,
  SettingsSyncStatus,
  Theme,
  UserPreferences,
} from "@types";
import {
  db,
  downloadSourcesSublevel,
  levelKeys,
  themesSublevel,
} from "@main/level";

import { logger } from "../logger";
import { PersonalCloud } from "../personal-cloud";
import { WindowManager } from "../window-manager";
import { getUserPreferences } from "../user-preferences";
import { generateSyncKey } from "./secret-box";
import {
  emptySettingsSyncState,
  fromSettingsDocument,
  mergeSettingsState,
  pickSyncedPreferences,
  pickSyncedSecrets,
  toSettingsDocument,
  type SettingsSyncDocument,
  type SettingsSyncState,
  type SyncedDownloadSource,
  type SyncedTheme,
} from "./settings-document";
import { recordCollection, recordLocalValues } from "./sync-merge";
import { describeSettingsSyncError } from "./sync-error";
import { SYNCED_SECRET_KEYS } from "./synced-keys";

const SETTINGS_FILE = "hydra/settings.json";
const KEY_FILE = "hydra/sync-key";
const PUSH_DELAY_MS = 5_000;
const PERIODIC_SYNC_MS = 15 * 60_000;

interface LocalSyncRecord {
  deviceId: string;
  enabled: boolean;
  lastSyncedAt: number | null;
  lastChangeFromDevice: string | null;
  state: SettingsSyncState;
  /** Keys this device actually had after the last sync. */
  localKeys: { downloadSources: string[]; themes: string[] };
}

interface StoredKey {
  data: string;
  encrypted: boolean;
}

const deviceLabel = () => os.hostname() || process.platform;

const newRecord = (): LocalSyncRecord => ({
  deviceId: `${deviceLabel()}-${randomUUID().slice(0, 8)}`,
  enabled: true,
  lastSyncedAt: null,
  lastChangeFromDevice: null,
  state: emptySettingsSyncState(),
  localKeys: { downloadSources: [], themes: [] },
});

const toSyncedTheme = (theme: Theme): SyncedTheme => ({
  id: theme.id,
  name: theme.name,
  author: theme.author,
  authorName: theme.authorName,
  isActive: theme.isActive,
  code: theme.code,
});

/**
 * Syncs settings, API keys, download sources and themes through the user's
 * Google Drive, using the Google sign-in shared with Cloud Save Manager. The
 * file is `hydra/settings.json`; credentials inside it are sealed with a key
 * kept next to it in `hydra/sync-key`.
 */
export class SettingsSync {
  private static running: Promise<void> | null = null;
  private static rerun = false;
  private static pushTimer: NodeJS.Timeout | null = null;
  private static periodicTimer: NodeJS.Timeout | null = null;
  private static applying = false;
  private static lastError: SettingsSyncError | null = null;

  private static async readRecord(): Promise<LocalSyncRecord> {
    const stored = await db
      .get<string, LocalSyncRecord | null>(levelKeys.settingsSync, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (stored?.deviceId) {
      return {
        ...newRecord(),
        ...stored,
        state: { ...emptySettingsSyncState(), ...stored.state },
      };
    }

    const record = newRecord();
    await this.writeRecord(record);
    return record;
  }

  private static writeRecord(record: LocalSyncRecord) {
    return db.put<string, LocalSyncRecord>(levelKeys.settingsSync, record, {
      valueEncoding: "json",
    });
  }

  private static async readCachedKey(): Promise<Buffer | null> {
    const stored = await db
      .get<string, StoredKey | null>(levelKeys.settingsSyncKey, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (!stored?.data) return null;
    try {
      const base64 = stored.encrypted
        ? safeStorage.decryptString(Buffer.from(stored.data, "base64"))
        : stored.data;
      return Buffer.from(base64, "base64");
    } catch {
      return null;
    }
  }

  private static async cacheKey(key: Buffer) {
    const base64 = key.toString("base64");
    const encrypted = safeStorage.isEncryptionAvailable();
    await db.put<string, StoredKey>(
      levelKeys.settingsSyncKey,
      {
        data: encrypted
          ? safeStorage.encryptString(base64).toString("base64")
          : base64,
        encrypted,
      },
      { valueEncoding: "json" }
    );
  }

  /** The shared key from Drive, created by whichever device syncs first. */
  private static async getKey(refresh = false): Promise<Buffer> {
    if (!refresh) {
      const cached = await this.readCachedKey();
      if (cached?.length === 32) return cached;
    }

    const remote = await PersonalCloud.readFile(KEY_FILE);
    const remoteKey: Buffer | null = remote
      ? Buffer.from(remote.toString("utf8").trim(), "base64")
      : null;

    let key: Buffer;
    if (remoteKey?.length === 32) {
      key = remoteKey;
    } else {
      key = generateSyncKey();
      await PersonalCloud.writeFile(
        KEY_FILE,
        Buffer.from(key.toString("base64"))
      );
    }

    await this.cacheKey(key);
    return key;
  }

  private static async readRemote(): Promise<SettingsSyncState | null> {
    const raw = await PersonalCloud.readFile(SETTINGS_FILE);
    if (!raw) return null;

    const document = JSON.parse(raw.toString("utf8")) as SettingsSyncDocument;
    try {
      return fromSettingsDocument(document, await this.getKey());
    } catch {
      // Another device may have replaced the key; read it again once.
      try {
        return fromSettingsDocument(document, await this.getKey(true));
      } catch (error) {
        logger.warn("Settings sync could not open synced API keys", error);
        return fromSettingsDocument(
          { ...document, secrets: null },
          Buffer.alloc(32)
        );
      }
    }
  }

  /** Stamps whatever changed on this device since the last sync. */
  private static async recordLocal(record: LocalSyncRecord, now: number) {
    const [preferences, sources, themes] = await Promise.all([
      getUserPreferences(),
      downloadSourcesSublevel.values().all(),
      themesSublevel.values().all(),
    ]);

    const sourceItems: Record<string, SyncedDownloadSource> = {};
    for (const source of sources) {
      sourceItems[source.url] = { name: source.name, url: source.url };
    }
    const themeItems: Record<string, SyncedTheme> = {};
    for (const theme of themes) themeItems[theme.id] = toSyncedTheme(theme);

    const { deviceId, state, localKeys } = record;
    const secrets = pickSyncedSecrets(preferences);
    return {
      preferences: recordLocalValues(
        state.preferences,
        pickSyncedPreferences(preferences),
        now,
        deviceId
      ),
      secrets: recordLocalValues<string>(
        state.secrets,
        Object.fromEntries(
          SYNCED_SECRET_KEYS.map((key) => [key, secrets[key]])
        ),
        now,
        deviceId
      ),
      downloadSources: recordCollection(
        state.downloadSources,
        sourceItems,
        localKeys.downloadSources,
        now,
        deviceId
      ),
      themes: recordCollection(
        state.themes,
        themeItems,
        localKeys.themes,
        now,
        deviceId
      ),
    } satisfies SettingsSyncState;
  }

  private static async applyIncoming(
    merged: SettingsSyncState,
    incoming: Record<keyof SettingsSyncState, string[]>
  ) {
    const preferenceChanges: Partial<UserPreferences> = {};
    for (const key of incoming.preferences) {
      const entry = merged.preferences[key];
      (preferenceChanges as Record<string, unknown>)[key] = entry.deleted
        ? null
        : entry.value;
    }
    for (const key of incoming.secrets) {
      const entry = merged.secrets[key];
      (preferenceChanges as Record<string, unknown>)[key] = entry.deleted
        ? null
        : entry.value;
    }

    if (Object.keys(preferenceChanges).length > 0) {
      const { applyUserPreferences } = await import(
        "@main/events/user-preferences/update-user-preferences"
      );
      await applyUserPreferences(preferenceChanges);
      await this.authorizeDebrid(preferenceChanges);
    }

    await this.applyDownloadSources(merged);

    if (incoming.themes.length > 0) {
      await this.applyThemes(merged, incoming.themes);
    }
  }

  private static async authorizeDebrid(changes: Partial<UserPreferences>) {
    const {
      RealDebridClient,
      PremiumizeClient,
      AllDebridClient,
      TorBoxClient,
    } = await import("../download");
    if (changes.realDebridApiToken) {
      RealDebridClient.authorize(changes.realDebridApiToken);
    }
    if (changes.premiumizeApiToken) {
      PremiumizeClient.authorize(changes.premiumizeApiToken);
    }
    if (changes.allDebridApiToken) {
      AllDebridClient.authorize(changes.allDebridApiToken);
    }
    if (changes.torBoxApiToken) {
      TorBoxClient.authorize(changes.torBoxApiToken);
    }
  }

  /**
   * Makes this device's sources match the merged list. Runs every sync, so a
   * source that failed to add last time (offline, say) is retried.
   */
  private static async applyDownloadSources(merged: SettingsSyncState) {
    const existing = await downloadSourcesSublevel.iterator().all();
    const { addDownloadSourceByUrl } = await import(
      "@main/events/download-sources/add-download-source"
    );

    for (const [url, entry] of Object.entries(merged.downloadSources)) {
      const local = existing.find(([, source]) => source.url === url);
      try {
        if (entry.deleted) {
          if (local) await downloadSourcesSublevel.del(local[0]);
        } else if (!local) {
          await addDownloadSourceByUrl(url);
        }
      } catch (error) {
        logger.warn(
          `Settings sync could not apply download source ${url}`,
          error
        );
      }
    }
  }

  private static async applyThemes(merged: SettingsSyncState, ids: string[]) {
    for (const id of ids) {
      const entry = merged.themes[id];
      if (entry.deleted || !entry.value) {
        await themesSublevel.del(id).catch(() => undefined);
        continue;
      }

      const current = await themesSublevel.get(id).catch(() => null);
      const now = new Date();
      await themesSublevel.put(id, {
        ...current,
        ...entry.value,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
    }

    // Only one theme can be active: the one that just came in wins here.
    const activated = ids.find((id) => merged.themes[id]?.value?.isActive);
    if (activated) {
      for (const theme of await themesSublevel.values().all()) {
        if (theme.id !== activated && theme.isActive) {
          await themesSublevel.put(theme.id, { ...theme, isActive: false });
        }
      }
    }

    WindowManager.mainWindow?.webContents.send("on-custom-theme-updated");
    const { achievementNotificationPresenter } = await import(
      "../achievement-notification-presenter-electron"
    );
    achievementNotificationPresenter.notifyThemeUpdated();
  }

  private static async runOnce() {
    const record = await this.readRecord();
    if (!record.enabled) return;

    const status = await PersonalCloud.status().catch(() => null);
    if (!status?.signedIn) return;

    const now = Date.now();
    const local = await this.recordLocal(record, now);
    const remote = await this.readRemote();
    const { merged, incoming, shouldPush } = mergeSettingsState(local, remote);

    this.applying = true;
    try {
      await this.applyIncoming(merged, incoming);
    } finally {
      this.applying = false;
    }

    const localChanged =
      JSON.stringify(local) !== JSON.stringify(record.state) || shouldPush;
    if (localChanged) {
      const document = toSettingsDocument(
        merged,
        await this.getKey(),
        now,
        record.deviceId
      );
      await PersonalCloud.writeFile(
        SETTINGS_FILE,
        Buffer.from(JSON.stringify(document))
      );
    }

    const [sources, themes] = await Promise.all([
      downloadSourcesSublevel.values().all(),
      themesSublevel.keys().all(),
    ]);
    const incomingDevices = Object.entries(incoming).flatMap(
      ([section, keys]) =>
        keys.map(
          (key) =>
            (
              merged as unknown as Record<
                string,
                Record<string, { deviceId: string }>
              >
            )[section][key].deviceId
        )
    );

    await this.writeRecord({
      ...record,
      lastSyncedAt: now,
      lastChangeFromDevice:
        incomingDevices.find((id) => id !== record.deviceId) ??
        record.lastChangeFromDevice,
      state: merged,
      localKeys: {
        downloadSources: sources.map((source) => source.url),
        themes,
      },
    });
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
        logger.error(`Settings sync failed (${this.lastError.reason})`, error);
      } finally {
        this.running = null;
        this.notify(false);
      }
    })();

    return this.running;
  }

  /** Pushes a few seconds after a change, so a burst of changes is one upload. */
  public static scheduleSync() {
    if (this.applying) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.syncNow();
    }, PUSH_DELAY_MS);
  }

  /** Syncs on launch and then periodically, to pick up other devices' changes. */
  public static start() {
    void this.syncNow();
    this.periodicTimer ??= setInterval(
      () => void this.syncNow(),
      PERIODIC_SYNC_MS
    );
  }

  public static async getStatus(): Promise<SettingsSyncStatus> {
    const [record, status] = await Promise.all([
      this.readRecord(),
      PersonalCloud.status().catch(() => null),
    ]);
    return {
      enabled: record.enabled,
      signedIn: status?.signedIn ?? false,
      syncing: this.running !== null,
      lastSyncedAt: record.lastSyncedAt,
      lastChangeFromDevice: record.lastChangeFromDevice,
      lastError: this.lastError,
    };
  }

  public static async setEnabled(enabled: boolean) {
    const record = await this.readRecord();
    await this.writeRecord({ ...record, enabled });
    if (enabled) await this.syncNow();
    return this.getStatus();
  }

  private static notify(syncing: boolean) {
    void this.getStatus()
      .then((status) =>
        WindowManager.sendToAppWindows("on-settings-sync-status", {
          ...status,
          syncing,
        })
      )
      .catch(() => undefined);
  }
}
