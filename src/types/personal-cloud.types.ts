import type { GameShop } from "./game.types";

/**
 * Cloud saves through Cloud Save Manager, the user's own Google Drive sync.
 * These mirror the napi objects in native/hydra-native/src/personal_cloud.rs.
 */

export interface PersonalCloudStatus {
  signedIn: boolean;
  paused: boolean;
  stateDir: string;
}

export interface PersonalCloudLinkInput {
  exePath: string;
  name: string;
  winePrefixPath?: string | null;
}

export interface PersonalCloudLinkResult {
  gameId: string;
  inCatalogue: boolean;
  saveLocation?: string | null;
}

export type PersonalCloudSyncOutcome =
  | "up_to_date"
  | "pulled"
  | "pushed"
  | "offline"
  | "waiting_for_prefix"
  | "not_in_catalogue"
  | "learning"
  | "paused"
  | "conflict";

export interface PersonalCloudSyncResult {
  outcome: PersonalCloudSyncOutcome;
  versionId?: string | null;
  queued: boolean;
  kept?: "local" | "cloud" | null;
  unclear: string[];
}

export interface PersonalCloudVersion {
  id: string;
  device: string;
  createdMs: number;
  size: number;
  fileCount: number;
  pinned: boolean;
  isCurrent: boolean;
}

export interface PersonalCloudSettled {
  atMs: number;
  keptLocal: boolean;
  otherVersion?: string | null;
}

export type PersonalCloudGameStatus =
  | "up_to_date"
  | "playing"
  | "upload_waiting"
  | "cloud_newer"
  | "both_changed"
  | "no_saves_yet"
  | "waiting_for_first_launch"
  | "not_on_this_device"
  | "offline";

export interface PersonalCloudGameInfo {
  gameId: string;
  name: string;
  inCatalogue: boolean;
  status: PersonalCloudGameStatus;
  statusLabel: string;
  saveLocation?: string | null;
  folder?: string | null;
  localFiles: number;
  localBytes: number;
  versions: PersonalCloudVersion[];
  settled?: PersonalCloudSettled | null;
}

/** What the game page shows for one Hydra game. */
export interface PersonalCloudGameState {
  status: PersonalCloudStatus;
  /** Null when the game has no exe yet, so it can't be linked. */
  info: PersonalCloudGameInfo | null;
}

/** Sent to the app windows after each automatic or manual sync. */
export interface PersonalCloudSyncEvent {
  shop: GameShop;
  objectId: string;
  phase: "pre-launch" | "post-exit" | "manual";
  result: PersonalCloudSyncResult | null;
  error: string | null;
}
