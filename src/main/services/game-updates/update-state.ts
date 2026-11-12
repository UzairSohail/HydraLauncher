import type {
  UpdateAsset,
  UpdateRelease,
  UpdateSourceConfig,
  UpdateSourceState,
  UpdateSourceStatus,
} from "@types";

import { selectReleaseAsset } from "./asset-selection.js";
import type { UpdateProvider } from "./update-provider.js";
import {
  compareVersions,
  isNewerRelease,
  type InstalledRelease,
} from "./version-compare.js";

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RETRY_BASE_DELAY_MS = 60 * 60 * 1000;

export const emptyStatus = (): UpdateSourceStatus => ({
  checkedAt: null,
  latest: null,
  error: null,
  failureCount: 0,
  retryAt: null,
  notifiedVersion: null,
});

export const isCheckDue = (status: UpdateSourceStatus, now: number) => {
  if (status.retryAt !== null) return now >= status.retryAt;
  return (
    status.checkedAt === null || now - status.checkedAt >= CHECK_INTERVAL_MS
  );
};

export const recordCheckSuccess = (
  status: UpdateSourceStatus,
  latest: UpdateRelease | null,
  now: number
): UpdateSourceStatus => ({
  ...status,
  checkedAt: now,
  latest,
  error: null,
  failureCount: 0,
  retryAt: null,
});

export const recordCheckFailure = (
  status: UpdateSourceStatus,
  error: string,
  now: number
): UpdateSourceStatus => {
  const failureCount = status.failureCount + 1;
  return {
    ...status,
    error,
    failureCount,
    retryAt:
      now +
      Math.min(
        RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failureCount - 1),
        CHECK_INTERVAL_MS
      ),
  };
};

export interface InstalledPort extends InstalledRelease {
  assetName: string | null;
}

export const selectInstallAsset = (
  provider: UpdateProvider | null,
  release: UpdateRelease | null,
  config: Pick<UpdateSourceConfig, "assetFilter">,
  installed: InstalledPort,
  platform: string,
  arch: string
): UpdateAsset | null => {
  if (!provider || !release || !provider.supportsDownloads) return null;
  if (provider.selectAsset) return provider.selectAsset(release, platform);
  return selectReleaseAsset(release.assets, {
    platform,
    arch,
    filter: config.assetFilter,
    previousAssetName: installed.assetName,
  });
};

export const buildSourceState = (
  config: UpdateSourceConfig,
  status: UpdateSourceStatus,
  provider: UpdateProvider | null,
  installed: InstalledPort,
  platform: string,
  arch: string
): UpdateSourceState => {
  const latest = provider ? status.latest : null;
  return {
    ...config,
    providerName: provider?.displayName ?? config.providerId,
    isProviderAvailable: provider !== null,
    isImplicit: provider?.isImplicit === true,
    sourceUrl: provider?.getSourceUrl(config.locator) ?? null,
    status,
    hasUpdate: latest !== null && isNewerRelease(latest, config.id, installed),
    installAsset: selectInstallAsset(
      provider,
      latest,
      config,
      installed,
      platform,
      arch
    ),
  };
};

/**
 * The installed source wins when it has an update, so a fork stays on its fork;
 * otherwise the newest downloadable update is chosen.
 */
export const pickBestSource = (
  sources: UpdateSourceState[],
  installedSourceId: string | null
): UpdateSourceState | null => {
  const updates = sources.filter((source) => source.hasUpdate);
  if (updates.length === 0) return null;

  const fromInstalled = updates.find(
    (source) => source.id === installedSourceId
  );
  if (fromInstalled?.installAsset) return fromInstalled;

  const downloadable = updates.filter((source) => source.installAsset);
  const candidates = downloadable.length > 0 ? downloadable : updates;
  return candidates.reduce((best, source) => {
    const comparison = compareVersions(
      source.status.latest?.version ?? "",
      best.status.latest?.version ?? ""
    );
    return comparison !== null && comparison > 0 ? source : best;
  });
};
