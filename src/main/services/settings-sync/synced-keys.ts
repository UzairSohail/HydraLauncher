import type { UserPreferences } from "@types";
import { SECRET_PREFERENCE_KEYS } from "../user-preferences/preference-secrets.js";

/**
 * Preferences that follow the user to every device. Anything not listed here
 * (paths, startup behaviour, Big Picture, Linux runtime, network options and
 * any preference added upstream later) stays local to the device.
 */
export const SYNCED_PREFERENCE_KEYS = [
  "language",
  "disableNsfwAlert",
  "seedAfterDownloadComplete",
  "showHiddenAchievementsDescription",
  "showDownloadSpeedInMegabits",
  "showDownloadSpeedInMegabytes",
  "downloadNotificationsEnabled",
  "repackUpdatesNotificationsEnabled",
  "achievementNotificationsEnabled",
  "achievementCustomNotificationsEnabled",
  "achievementCustomNotificationPosition",
  "achievementSoundVolume",
  "friendRequestNotificationsEnabled",
  "friendStartGameNotificationsEnabled",
  "chatMessageNotificationsEnabled",
  "leaderboardSlamEnabled",
  "leaderboardDropNotificationsEnabled",
  "extractFilesByDefault",
  "deleteArchiveFilesAfterExtractionByDefault",
  "enableSteamAchievements",
  "enableAchievementSouvenirs",
  "autoplayGameTrailers",
  "hideToTrayOnGameStart",
  "enableNewDownloadOptionsBadges",
  "globalTrackers",
  "appendGlobalTrackers",
  "globalTrackersUrl",
  "appendGlobalTrackersUrl",
  "hideClassicsBookmark",
  "classicsUseHeroLayout",
  "hideLibraryGameBadges",
  "hideLibraryReadySizeBadges",
  "hideLibraryClassicsBadges",
  "hideSteamLibraryBadges",
  "hideEpicLibraryBadges",
  "hideLibraryAchievementProgress",
  "autoplayAnimatedArtwork",
  "persistFiltersAndSorting",
  "screenshotsEnabled",
  "screenshotHotkey",
  "screenshotGamepadEnabled",
  "screenshotGamepadCombo",
  "screenshotCaptureSoundEnabled",
  "screenshotToastEnabled",
  "screenshotDefaultVisibility",
  "showSensitiveScreenshots",
  "hideCommunityScreenshots",
  "retroAchievementsUsername",
] as const satisfies readonly (keyof UserPreferences)[];

export type SyncedPreferenceKey = (typeof SYNCED_PREFERENCE_KEYS)[number];

/** Credentials sync too, but only inside the encrypted section. */
export const SYNCED_SECRET_KEYS = SECRET_PREFERENCE_KEYS;
