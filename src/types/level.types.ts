import type { Downloader, GameUpdateInfo, InstalledRepackInfo } from "@shared";
import type { GameShop } from "./game.types";
import type { DownloadStatus } from "./download.types";
import type { ClassicsDisc } from "./emulator.types";
import type {
  ScreenshotGamepadButton,
  ScreenshotHotkeyBinding,
} from "./screenshot.types";
import type { ProfileVisibility } from "./index";
import type {
  EpicDownloadMetadata,
  EpicInstallation,
} from "./epic-managed.types";

export type SubscriptionStatus = "active" | "pending" | "cancelled";

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  plan: { id: string; name: string };
  expiresAt: string | null;
  paymentMethod: "pix" | "paypal";
}

export interface Auth {
  accessToken: string;
  refreshToken: string;
  tokenExpirationTimestamp: number;
  workwondersJwt: string;
}

export interface User {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  subscription: Subscription | null;
}

export interface CatalogueGameIdentity {
  shop: GameShop;
  objectId: string;
}

export interface LibraryCatalogueMetadata {
  canonicalId?: string;
  catalogueGame?: CatalogueGameIdentity;
  availableShops?: GameShop[];
}

export interface Game extends LibraryCatalogueMetadata {
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  customIconUrl?: string | null;
  customLogoImageUrl?: string | null;
  customHeroImageUrl?: string | null;
  customCoverImageUrl?: string | null;
  originalIconPath?: string | null;
  originalLogoPath?: string | null;
  originalHeroPath?: string | null;
  customOriginalIconPath?: string | null;
  customOriginalLogoPath?: string | null;
  customOriginalHeroPath?: string | null;
  customOriginalCoverPath?: string | null;
  playTimeInMilliseconds: number;
  steamPlayTimeInMilliseconds?: number;
  epicPlayTimeInMilliseconds?: number;
  epicInstallation?: EpicInstallation;
  hasActiveEpicImport?: boolean;
  epicImportScope?: {
    environment: string;
    userId: string;
    connectionId: string;
  };
  hasActiveSteamImport?: boolean;
  enableHydraPlaytimeTracking?: boolean;
  unsyncedDeltaPlayTimeInMilliseconds?: number;
  lastTimePlayed: Date | null;
  addedToLibraryAt?: Date | null;
  objectId: string;
  shop: GameShop;
  remoteId: string | null;
  source?: "hydra" | "steam" | "epic";
  collectionIds?: string[];
  collectionPositions?: Record<string, number>;
  isDeleted: boolean;
  winePrefixPath?: string | null;
  protonPath?: string | null;
  executablePath?: string | null;
  executablePathUpdatedAt?: Date | null;
  trackingExecutablePaths?: string[] | null;
  trackingExecutablePathsUpdatedAt?: Date | null;
  launchOptions?: string | null;
  autoRunMangohud?: boolean | null;
  autoRunGamemode?: boolean | null;
  favorite?: boolean;
  isHiddenFromOthers?: boolean;
  isConcealed?: boolean;
  isPinned?: boolean;
  achievementCount?: number;
  unlockedAchievementCount?: number;
  reportedUnlockedAchievementCount?: number;
  pinnedDate?: Date | null;
  automaticCloudSync?: boolean;
  hasManuallyUpdatedPlaytime?: boolean;
  newDownloadOptionsCount?: number;
  /** The download source listing the installed version came from. */
  installedRepack?: InstalledRepackInfo | null;
  /** A newer version that the same source lists, if any. */
  availableUpdate?: GameUpdateInfo | null;
  /** A listing the user chose to skip, so it isn't offered again. */
  skippedUpdateRepackId?: string | null;
  /** The version an update is replacing, kept playable until the new one is ready. */
  previousInstall?: PreviousInstall | null;
  installedSizeInBytes?: number | null;
  installerSizeInBytes?: number | null;
  steamShortcutAppId?: number;
  platform?: string | null;
  discs?: ClassicsDisc[];
  selectedDiscPath?: string | null;
  dontAskDiscSelection?: boolean;
  romSizeBytes?: number | null;
}

export interface PreviousInstall {
  /** Where the old files were moved aside while the update downloads. */
  folderPath: string | null;
  /** Where the old files were, so a cancelled update can put them back. */
  originalFolderPath: string | null;
  download: Download | null;
  installedRepack: InstalledRepackInfo | null;
  executablePath: string | null;
}

export interface DownloadFile {
  index: number;
  path: string;
  size: number;
  bytesDownloaded: number;
  completed: boolean;
}

export interface Download {
  epic?: EpicDownloadMetadata;
  shop: GameShop;
  objectId: string;
  uri: string;
  /** Ordered part URIs of a multi-part hoster download. `uri` is the first part. */
  parts?: string[];
  folderName: string | null;
  downloadPath: string;
  progress: number;
  downloader: Downloader;
  bytesDownloaded: number;
  fileSize: number | null;
  shouldSeed: boolean;
  status: DownloadStatus | null;
  queued: boolean;
  pinnedToHero?: boolean;
  timestamp: number;
  extracting: boolean;
  extractionProgress?: number;
  installerLaunched?: boolean;
  installerRunning?: boolean;
  installerStartedAt?: number;
  installerPath?: string;
  hasInstaller?: boolean;
  sourceArchiveName?: string;
  // Archives Hydra started extracting in place, kept until the whole download
  // is extracted. Only these are resumed, since a progress file next to an
  // archive may have come with the download.
  inPlaceArchives?: string[];
  automaticallyExtract: boolean;
  automaticallyDeleteArchiveFiles: boolean;
  fileIndices?: number[];
  files?: DownloadFile[];
  selectedFilesSize?: number | null;
  realDebridTorrentId?: string;
  awaitingDebrid?: boolean;
  debridAutoResume?: boolean;
  /** How far the debrid provider has got caching an uncached magnet (0..1). */
  debridRemoteProgress?: number;
  debridQueueOnly?: boolean;
  debridQueuePosition?: number;
  debridPreparationDeadline?: number;
  customTrackers?: string[];
}

export interface DownloadLayoutState {
  version: 1;
  queueOrder: string[];
  pausedOrder: string[];
}

export type AchievementCustomNotificationPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type BigPictureDiagnosticsPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface DownloadDirectoryPreference {
  path: string;
  createdAt: string;
  source: "manual" | "auto";
}

export interface UserPreferences {
  downloadsPath?: string | null;
  defaultWinePrefixPath?: string | null;
  downloadDirectories?: DownloadDirectoryPreference[];
  optionalDownloadsPaths?: string[];
  ggDealsApiKey?: string | null;
  language?: string;
  realDebridApiToken?: string | null;
  premiumizeApiToken?: string | null;
  allDebridApiToken?: string | null;
  torBoxApiToken?: string | null;
  retroAchievementsWebApiKey?: string | null;
  retroAchievementsUsername?: string | null;
  preferQuitInsteadOfHiding?: boolean;
  openFriendsWindowOnStartup?: boolean;
  runAtStartup?: boolean;
  startMinimized?: boolean;
  launchToLibraryPage?: boolean;
  bigPictureLaunchToLibraryPage?: boolean;
  launchInBigPicture?: boolean;
  disableNsfwAlert?: boolean;
  enableAutoInstall?: boolean;
  seedAfterDownloadComplete?: boolean;
  showHiddenAchievementsDescription?: boolean;
  showDownloadSpeedInMegabits?: boolean;
  downloadNotificationsEnabled?: boolean;
  repackUpdatesNotificationsEnabled?: boolean;
  achievementNotificationsEnabled?: boolean;
  achievementCustomNotificationsEnabled?: boolean;
  achievementCustomNotificationPosition?: AchievementCustomNotificationPosition;
  achievementSoundVolume?: number;
  friendRequestNotificationsEnabled?: boolean;
  friendStartGameNotificationsEnabled?: boolean;
  chatMessageNotificationsEnabled?: boolean;
  leaderboardSlamEnabled?: boolean;
  leaderboardDropNotificationsEnabled?: boolean;
  showDownloadSpeedInMegabytes?: boolean;
  extractFilesByDefault?: boolean;
  deleteArchiveFilesAfterExtractionByDefault?: boolean;
  enableSteamAchievements?: boolean;
  enableAchievementSouvenirs?: boolean;
  achievementScreenshotsPath?: string;
  autoplayGameTrailers?: boolean;
  hideToTrayOnGameStart?: boolean;
  useNativeWindowDecorations?: boolean;
  enableNewDownloadOptionsBadges?: boolean;
  createStartMenuShortcut?: boolean;
  bigPictureSoundsEnabled?: boolean;
  bigPictureVirtualKeyboardEnabled?: boolean;
  bigPictureDiagnosticsEnabled?: boolean;
  bigPictureDiagnosticsPosition?: BigPictureDiagnosticsPosition;
  maxDownloadSpeedBytesPerSecond?: number | null;
  torrentNetworkInterface?: string | null;
  globalTrackers?: string[];
  appendGlobalTrackers?: boolean;
  globalTrackersUrl?: string;
  appendGlobalTrackersUrl?: boolean;
  defaultProtonPath?: string | null;
  autoRunMangohud?: boolean;
  autoRunGamemode?: boolean;
  hideClassicsBookmark?: boolean;
  classicsUseHeroLayout?: boolean;
  hideLibraryGameBadges?: boolean;
  hideLibraryReadySizeBadges?: boolean;
  hideLibraryClassicsBadges?: boolean;
  hideSteamLibraryBadges?: boolean;
  hideEpicLibraryBadges?: boolean;
  hideLibraryAchievementProgress?: boolean;
  autoplayAnimatedArtwork?: boolean;
  persistFiltersAndSorting?: boolean;
  screenshotsEnabled?: boolean;
  screenshotsFolderPath?: string;
  screenshotHotkey?: ScreenshotHotkeyBinding;
  screenshotGamepadEnabled?: boolean;
  screenshotGamepadCombo?: ScreenshotGamepadButton[];
  screenshotCaptureSoundEnabled?: boolean;
  screenshotToastEnabled?: boolean;
  screenshotDefaultVisibility?: ProfileVisibility;
  showSensitiveScreenshots?: boolean;
  hideCommunityScreenshots?: boolean;
}

export interface NetworkInterface {
  name: string;
  addresses: string[];
}

export interface ScreenState {
  x?: number;
  y?: number;
  height: number;
  width: number;
  isMaximized: boolean;
}
