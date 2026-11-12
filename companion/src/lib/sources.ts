import { PHONE_DEVICE_ID } from "./config";
import { readFile, writeFile } from "./drive";

const SETTINGS_FILE = "hydra/settings.json";

interface SyncEntry<T> {
  value: T | null;
  updatedAt: number;
  deviceId: string;
  deleted?: true;
}

export interface SyncedSource {
  name: string;
  url: string;
}

/**
 * The launchers' synced settings file. Only the download sources are touched;
 * everything else, including the encrypted keys, is written back as it was.
 */
type SettingsFile = Record<string, unknown> & {
  version: 1;
  updatedAt: number;
  deviceId: string;
  downloadSources?: Record<string, SyncEntry<SyncedSource>>;
};

const loadSettings = async (): Promise<SettingsFile | null> => {
  const text = await readFile(SETTINGS_FILE);
  if (!text) return null;
  return JSON.parse(text) as SettingsFile;
};

/** The download sources every launcher shares, by URL. */
export const loadSources = async (): Promise<SyncedSource[]> => {
  const settings = await loadSettings();
  return Object.entries(settings?.downloadSources ?? {})
    .filter(([, entry]) => !entry.deleted && entry.value)
    .map(([url, entry]) => ({ name: entry.value?.name ?? url, url }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Records a change the same way a launcher does: a newer entry for that URL.
 * Each launcher applies it the next time it syncs settings.
 */
const changeSource = async (url: string, value: SyncedSource | null) => {
  const settings = await loadSettings();
  if (!settings) {
    throw new Error(
      "Turn on settings sync in the launcher first, so there's a source list to change."
    );
  }
  const now = Date.now();
  const entry: SyncEntry<SyncedSource> = value
    ? { value, updatedAt: now, deviceId: PHONE_DEVICE_ID }
    : { value: null, updatedAt: now, deviceId: PHONE_DEVICE_ID, deleted: true };
  const next: SettingsFile = {
    ...settings,
    updatedAt: now,
    deviceId: PHONE_DEVICE_ID,
    downloadSources: { ...(settings.downloadSources ?? {}), [url]: entry },
  };
  await writeFile(SETTINGS_FILE, JSON.stringify(next));
};

export const addSource = (source: SyncedSource) => changeSource(source.url, source);

export const removeSource = (url: string) => changeSource(url, null);
