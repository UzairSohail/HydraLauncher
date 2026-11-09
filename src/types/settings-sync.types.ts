/** Why the last settings sync failed, so the card can say what to do. */
export type SettingsSyncErrorReason =
  /** This build has no Google client and there's no client.json either. */
  | "no_client"
  /** The stored Google sign-in is missing, expired or revoked. */
  | "sign_in_expired"
  /** Google rejected the sign-in itself, usually a client mismatch. */
  | "sign_in_rejected"
  /** Google Drive refused the request (permissions, quota, API off). */
  | "drive_refused"
  /** No connection to Google. */
  | "offline"
  /** `hydra/settings.json` in Drive couldn't be read. */
  | "bad_file"
  | "unknown";

export interface SettingsSyncError {
  reason: SettingsSyncErrorReason;
  /** The underlying message, shortened, for anything the reason doesn't say. */
  detail: string;
}

export interface SettingsSyncStatus {
  /** The user's switch. On by default once Google is signed in. */
  enabled: boolean;
  signedIn: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  /** Device whose change the last pull brought in, if any. */
  lastChangeFromDevice: string | null;
  lastError: SettingsSyncError | null;
}
