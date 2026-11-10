# Achievement sync (Google Drive)

Nacho syncs unlocked achievements between your devices through your own Google
Drive, using the same Google sign-in as cloud saves and settings sync. No Hydra
account or subscription is needed.

- File: `hydra/achievements.json` in the Cloud Save Manager Drive folder.
- Merge: an achievement unlocked on any device counts as unlocked everywhere,
  at the earliest unlock time any device recorded. Nothing is ever removed.
- When: on launch, every 15 minutes, 10 seconds after a new unlock, and right
  after signing in to Google.
- Local copy: level key `achievementSync` holds this device's id and every
  synced unlock, so unlocks from other devices show while offline too.
- Code: `src/main/services/achievement-sync/`. Unlocks from Drive are added on
  read (`SyncedUnlocksStore.withSynced`) in `mergeAchievements`,
  `getUnlockedAchievements` and the library's unlocked counts.
- Game page: the achievements box says whether sync is on. When you aren't
  signed in to Google it links to Settings → Integrations.

Epic and custom games are not synced (Epic tracks its own achievements).
Unlocks are matched per store copy (`shop:objectId`), so the same game bought
on two stores syncs as two games.
