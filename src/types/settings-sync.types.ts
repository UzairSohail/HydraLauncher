export interface SettingsSyncStatus {
  /** The user's switch. On by default once Google is signed in. */
  enabled: boolean;
  signedIn: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  /** Device whose change the last pull brought in, if any. */
  lastChangeFromDevice: string | null;
  lastError: string | null;
}
