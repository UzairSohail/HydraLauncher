import type { UnlockedAchievement } from "@types";

/** One unlock as kept in Drive. Times are milliseconds since the epoch. */
export interface SyncedUnlock {
  unlockTime: number;
  hardcoreUnlockTime?: number | null;
}

/** Unlocks per game key (`shop:objectId`), then per upper-case achievement name. */
export type SyncedAchievements = Record<string, Record<string, SyncedUnlock>>;

/** The file at `hydra/achievements.json` in the user's Drive. */
export interface AchievementSyncDocument {
  version: 1;
  updatedAt: number;
  deviceId: string;
  games: SyncedAchievements;
}

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** The earlier of two times, ignoring missing or zero ones. */
const earliest = (
  a: number | null | undefined,
  b: number | null | undefined
): number | null => {
  if (isTime(a) && isTime(b)) return Math.min(a, b);
  if (isTime(a)) return a;
  if (isTime(b)) return b;
  return null;
};

const mergeUnlock = (
  a: SyncedUnlock | undefined,
  b: SyncedUnlock | undefined
): SyncedUnlock => {
  const unlockTime = earliest(a?.unlockTime, b?.unlockTime) ?? 0;
  const hardcoreUnlockTime = earliest(
    a?.hardcoreUnlockTime,
    b?.hardcoreUnlockTime
  );
  return hardcoreUnlockTime
    ? { unlockTime, hardcoreUnlockTime }
    : { unlockTime };
};

const sameUnlock = (a: SyncedUnlock | undefined, b: SyncedUnlock) =>
  a !== undefined &&
  a.unlockTime === b.unlockTime &&
  (a.hardcoreUnlockTime ?? null) === (b.hardcoreUnlockTime ?? null);

export interface AchievementMergeResult {
  merged: SyncedAchievements;
  /** Games whose unlocks gained something from `incoming`. */
  changedGames: string[];
}

/**
 * Unions two sets of unlocks. An achievement unlocked on any device stays
 * unlocked, at the earliest time any device saw it.
 */
export const mergeSyncedAchievements = (
  base: SyncedAchievements,
  incoming: SyncedAchievements
): AchievementMergeResult => {
  const merged: SyncedAchievements = {};
  const changed = new Set<string>();

  for (const gameKey of new Set([
    ...Object.keys(base),
    ...Object.keys(incoming),
  ])) {
    const baseGame = base[gameKey] ?? {};
    const incomingGame = incoming[gameKey] ?? {};
    const game: Record<string, SyncedUnlock> = {};

    for (const name of new Set([
      ...Object.keys(baseGame),
      ...Object.keys(incomingGame),
    ])) {
      const unlock = mergeUnlock(baseGame[name], incomingGame[name]);
      if (!isTime(unlock.unlockTime)) continue;
      game[name] = unlock;
      if (!sameUnlock(baseGame[name], unlock)) changed.add(gameKey);
    }

    if (Object.keys(game).length > 0) merged[gameKey] = game;
  }

  return { merged, changedGames: [...changed] };
};

/** Turns a game's unlock list into the synced shape, by upper-case name. */
export const toSyncedGame = (
  unlocked: UnlockedAchievement[]
): Record<string, SyncedUnlock> => {
  const game: Record<string, SyncedUnlock> = {};
  for (const achievement of unlocked) {
    if (!achievement.name) continue;
    const name = achievement.name.toUpperCase();
    const unlock = mergeUnlock(game[name], {
      unlockTime: achievement.unlockTime,
      hardcoreUnlockTime: achievement.hardcoreUnlockTime,
    });
    if (isTime(unlock.unlockTime)) game[name] = unlock;
  }
  return game;
};

/** The synced unlocks of one game as Hydra's unlock list. */
export const fromSyncedGame = (
  game: Record<string, SyncedUnlock> | undefined
): UnlockedAchievement[] =>
  Object.entries(game ?? {}).map(([name, unlock]) => ({
    name,
    unlockTime: unlock.unlockTime,
    hardcoreUnlockTime: unlock.hardcoreUnlockTime ?? null,
  }));

/**
 * Adds synced unlocks the list doesn't have yet. Entries already in the list
 * keep their data (souvenir keys, say), and take the synced time when it's
 * earlier.
 */
export const withSyncedUnlocks = (
  unlocked: UnlockedAchievement[],
  game: Record<string, SyncedUnlock> | undefined
): UnlockedAchievement[] => {
  if (!game || Object.keys(game).length === 0) return unlocked;

  const seen = new Set<string>();
  const result = unlocked.map((achievement) => {
    const name = achievement.name.toUpperCase();
    seen.add(name);
    const synced = game[name];
    if (!synced) return achievement;
    const unlockTime =
      earliest(achievement.unlockTime, synced.unlockTime) ??
      achievement.unlockTime;
    const hardcoreUnlockTime = earliest(
      achievement.hardcoreUnlockTime,
      synced.hardcoreUnlockTime
    );
    return unlockTime === achievement.unlockTime &&
      hardcoreUnlockTime === (achievement.hardcoreUnlockTime ?? null)
      ? achievement
      : { ...achievement, unlockTime, hardcoreUnlockTime };
  });

  for (const [name, unlock] of Object.entries(game)) {
    if (seen.has(name)) continue;
    result.push({
      name,
      unlockTime: unlock.unlockTime,
      hardcoreUnlockTime: unlock.hardcoreUnlockTime ?? null,
    });
  }

  return result;
};

/** Reads a document from Drive, dropping anything malformed. */
export const parseAchievementDocument = (raw: string): SyncedAchievements => {
  const document = JSON.parse(raw) as Partial<AchievementSyncDocument>;
  const games: SyncedAchievements = {};
  if (!document || typeof document.games !== "object" || !document.games) {
    return games;
  }

  for (const [gameKey, game] of Object.entries(document.games)) {
    if (!game || typeof game !== "object") continue;
    const clean: Record<string, SyncedUnlock> = {};
    for (const [name, unlock] of Object.entries(game)) {
      if (!unlock || !isTime(unlock.unlockTime)) continue;
      clean[name.toUpperCase()] = mergeUnlock(clean[name.toUpperCase()], {
        unlockTime: unlock.unlockTime,
        hardcoreUnlockTime: isTime(unlock.hardcoreUnlockTime)
          ? unlock.hardcoreUnlockTime
          : null,
      });
    }
    if (Object.keys(clean).length > 0) games[gameKey] = clean;
  }

  return games;
};

export const toAchievementDocument = (
  games: SyncedAchievements,
  now: number,
  deviceId: string
): AchievementSyncDocument => ({ version: 1, updatedAt: now, deviceId, games });
