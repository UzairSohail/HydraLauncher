/**
 * Last-writer-wins merge used by settings sync. Every synced value carries the
 * time and device of its last change; on a conflict the newer change wins,
 * per key rather than per file. Deletions are kept as tombstones so a removed
 * item is not brought back by a device that still has it.
 */

export interface SyncEntry<T> {
  value: T | null;
  updatedAt: number;
  deviceId: string;
  deleted?: true;
}

export type SyncEntries<T> = Record<string, SyncEntry<T>>;

/** True when `a` should win over `b`. Ties go to the higher device ID so every device agrees. */
export const isNewerEntry = <T>(a: SyncEntry<T>, b: SyncEntry<T>) =>
  a.updatedAt > b.updatedAt ||
  (a.updatedAt === b.updatedAt && a.deviceId > b.deviceId);

export const mergeSyncEntries = <T>(
  local: SyncEntries<T>,
  remote: SyncEntries<T>
): SyncEntries<T> => {
  const merged: SyncEntries<T> = { ...local };

  for (const [key, remoteEntry] of Object.entries(remote)) {
    const localEntry = merged[key];
    if (!localEntry || isNewerEntry(remoteEntry, localEntry)) {
      merged[key] = remoteEntry;
    }
  }

  return merged;
};

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Stamps entries for values that changed locally. A key with no entry yet gets
 * time 0, so on a device that never synced, anything already in the cloud
 * wins over what was there before.
 */
export const recordLocalValues = <T>(
  entries: SyncEntries<T>,
  values: Record<string, T | null | undefined>,
  now: number,
  deviceId: string
): SyncEntries<T> => {
  const next: SyncEntries<T> = { ...entries };

  for (const [key, value] of Object.entries(values)) {
    const current = next[key];
    const isDeleted = value === undefined || value === null;

    if (!current) {
      if (isDeleted) continue;
      next[key] = { value, updatedAt: 0, deviceId };
      continue;
    }

    const currentlyDeleted = current.deleted === true;
    if (isDeleted && currentlyDeleted) continue;
    if (!isDeleted && !currentlyDeleted && sameValue(current.value, value)) {
      continue;
    }

    next[key] = isDeleted
      ? { value: null, updatedAt: now, deviceId, deleted: true }
      : { value, updatedAt: now, deviceId };
  }

  return next;
};

/** Marks keys that disappeared from a keyed collection (download sources, themes). */
export const recordCollection = <T>(
  entries: SyncEntries<T>,
  items: Record<string, T>,
  now: number,
  deviceId: string
): SyncEntries<T> => {
  const values: Record<string, T | null> = { ...items };
  for (const key of Object.keys(entries)) {
    if (!Object.hasOwn(items, key)) values[key] = null;
  }
  return recordLocalValues(entries, values, now, deviceId);
};

/** The live values after a merge, without tombstones. */
export const entryValues = <T>(entries: SyncEntries<T>): Record<string, T> => {
  const values: Record<string, T> = {};
  for (const [key, entry] of Object.entries(entries)) {
    if (!entry.deleted && entry.value !== null) values[key] = entry.value;
  }
  return values;
};

/** Keys whose winning entry differs from what this side had. */
export const changedKeys = <T>(
  before: SyncEntries<T>,
  after: SyncEntries<T>
): string[] =>
  Object.keys(after).filter((key) => {
    const a = before[key];
    const b = after[key];
    return (
      !a ||
      a.updatedAt !== b.updatedAt ||
      a.deviceId !== b.deviceId ||
      !sameValue(a.value, b.value)
    );
  });
