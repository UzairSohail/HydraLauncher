export type UpdateChannel = "stable" | "prerelease";

export interface UpdateAsset {
  name: string;
  url: string;
  size: number | null;
  sha256: string | null;
}

export interface UpdateRelease {
  version: string;
  tag: string | null;
  name: string | null;
  publishedAt: string | null;
  /** Page for the release, opened when it has no downloadable asset. */
  pageUrl: string | null;
  notesMarkdown: string | null;
  isPrerelease: boolean;
  assets: UpdateAsset[];
}

export interface UpdateProviderInfo {
  id: string;
  displayName: string;
  /** A sample of what the user types, shown as a placeholder. */
  inputExample: string;
  supportsChannels: boolean;
  supportsDownloads: boolean;
  isBuiltIn: boolean;
  /** Hidden from the add-source form, e.g. the catalog source every port gets. */
  isImplicit: boolean;
}

export interface UpdateSourceConfig {
  id: string;
  providerId: string;
  /** The provider's normalized form of what the user typed. */
  locator: string;
  channel: UpdateChannel;
  /** Case-insensitive substring or /regex/ used to pick the release file. */
  assetFilter: string | null;
  addedAt: string;
}

export interface UpdateSourceStatus {
  checkedAt: number | null;
  latest: UpdateRelease | null;
  error: string | null;
  failureCount: number;
  retryAt: number | null;
  notifiedVersion: string | null;
}

export interface UpdateSourceState extends UpdateSourceConfig {
  providerName: string;
  isProviderAvailable: boolean;
  isImplicit: boolean;
  sourceUrl: string | null;
  status: UpdateSourceStatus;
  hasUpdate: boolean;
  /** The file that would be installed, or null when the update is manual. */
  installAsset: UpdateAsset | null;
}

export interface RecompilationUpdateState {
  objectId: string;
  slug: string;
  name: string;
  installedVersion: string | null;
  installedSourceId: string | null;
  sources: UpdateSourceState[];
  /** The source the Update button installs from. */
  bestSourceId: string | null;
  previousVersion: string | null;
  saveSnapshotCount: number;
}

export interface RecompilationUpdateSummary {
  objectId: string;
  slug: string;
  name: string;
  installedVersion: string | null;
  latestVersion: string;
  sourceId: string;
}

export interface AddUpdateSourceInput {
  providerId: string;
  input: string;
  channel?: UpdateChannel;
  assetFilter?: string | null;
}

export type UpdateSourceActionResult =
  | { ok: true }
  | { ok: false; reason: string };
