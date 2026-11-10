import type { GameShop, UnlockedAchievement } from "@types";

import {
  withSyncedUnlocks,
  type SyncedAchievements,
  type SyncedUnlock,
} from "./achievement-document.js";

let games: SyncedAchievements = {};

const gameKey = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

/**
 * Unlocks synced through Google Drive, from this device and the user's other
 * devices, kept in memory so achievement reads can add them without waiting.
 * `AchievementSync` loads and updates it.
 */
export const SyncedUnlocksStore = {
  replace(next: SyncedAchievements) {
    games = next;
  },

  all(): SyncedAchievements {
    return games;
  },

  get(
    shop: GameShop,
    objectId: string
  ): Record<string, SyncedUnlock> | undefined {
    return games[gameKey(shop, objectId)];
  },

  /** The list plus any unlock another device synced for this game. */
  withSynced(
    shop: GameShop,
    objectId: string,
    unlocked: UnlockedAchievement[]
  ): UnlockedAchievement[] {
    if (shop === "epic" || shop === "custom") return unlocked;
    return withSyncedUnlocks(unlocked, games[gameKey(shop, objectId)]);
  },
};
