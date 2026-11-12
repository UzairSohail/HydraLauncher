import type {
  RecompilationDetails,
  RecompilationReleases,
  UpdateRelease,
} from "@types";
import {
  isRecompilationAssetFromRepository,
  pickRecompilationInstallAsset,
} from "@shared";
import { HydraApi } from "@main/services/hydra-api";

import { UpdateProviderError, type UpdateProvider } from "../update-provider";

export const HYDRA_CATALOG_PROVIDER_ID = "catalog";

/** Locator for the catalog entry of a port. */
export const toCatalogLocator = (objectId: string, slug: string) =>
  `${objectId}/${slug}`;

const parseLocator = (locator: string) => {
  const [objectId, slug] = locator.split("/");
  return objectId && slug ? { objectId, slug } : null;
};

/**
 * The curated release every catalog port already had. Its assets are narrowed
 * to the install target for this OS that comes from the port's own repository.
 */
export const hydraCatalogProvider: UpdateProvider = {
  id: HYDRA_CATALOG_PROVIDER_ID,
  displayName: "Nacho Launcher catalog",
  inputExample: "",
  supportsChannels: false,
  supportsDownloads: true,
  isImplicit: true,

  parseInput: (input) => (parseLocator(input.trim()) ? input.trim() : null),

  getSourceUrl: () => null,

  async fetchLatest(locator) {
    const ref = parseLocator(locator);
    if (!ref) throw new UpdateProviderError("not_found");

    const path = `/games/launchbox/${ref.objectId}/recompilations/${ref.slug}`;
    const [details, { releases }] = await Promise.all([
      HydraApi.get<RecompilationDetails>(path, undefined, { needsAuth: false }),
      HydraApi.get<RecompilationReleases>(`${path}/releases`, undefined, {
        needsAuth: false,
      }),
    ]);

    const release =
      releases.find((item) => item.isLatest) ?? releases.at(0) ?? null;
    if (!release) return null;

    const asset = pickRecompilationInstallAsset(
      release.assets,
      process.platform
    );
    const trusted =
      asset &&
      isRecompilationAssetFromRepository(
        asset,
        details.repository.fullName,
        release.tag
      )
        ? asset
        : null;

    const result: UpdateRelease = {
      version: release.version,
      tag: release.tag,
      name: release.name,
      publishedAt: release.publishedAt,
      pageUrl: release.url,
      notesMarkdown: release.notesMarkdown,
      isPrerelease: false,
      assets: trusted
        ? [
            {
              name: trusted.name,
              url: trusted.url,
              size: trusted.size,
              sha256: trusted.sha256,
            },
          ]
        : [],
    };
    return result;
  },

  selectAsset: (release) => release.assets[0] ?? null,
};
