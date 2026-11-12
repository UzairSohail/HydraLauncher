import { Downloader } from "../../../shared/constants.js";
import type { CompanionRepack } from "../../../shared/companion.js";
import type { UserPreferences } from "@types";

type DebridTokens = Pick<
  UserPreferences,
  | "realDebridApiToken"
  | "premiumizeApiToken"
  | "allDebridApiToken"
  | "torBoxApiToken"
>;

/** Same order the download dialog prefers: AllDebrid first. */
const PREFERRED = [
  Downloader.AllDebrid,
  Downloader.RealDebrid,
  Downloader.Premiumize,
  Downloader.TorBox,
];

const isConfigured = (
  downloader: Downloader,
  tokens: DebridTokens | null | undefined
) => {
  switch (downloader) {
    case Downloader.AllDebrid:
      return Boolean(tokens?.allDebridApiToken);
    case Downloader.RealDebrid:
      return Boolean(tokens?.realDebridApiToken);
    case Downloader.Premiumize:
      return Boolean(tokens?.premiumizeApiToken);
    case Downloader.TorBox:
      return Boolean(tokens?.torBoxApiToken);
    // Needs a Hydra subscription, which Nacho doesn't have.
    case Downloader.VikingFile:
    case Downloader.Hydra:
    case Downloader.Torrent:
    case Downloader.Epic:
      return false;
    default:
      return true;
  }
};

/**
 * Picks the link and downloader for a listing queued from the phone, the way
 * the download dialog's defaults would: the preferred debrid service when one
 * is set up, otherwise a direct download. Torrents are never downloaded peer to
 * peer, only through debrid.
 */
export const pickCompanionDownload = (
  repack: Pick<CompanionRepack, "uris" | "unavailableUris">,
  tokens: DebridTokens | null | undefined,
  /** `getDownloadersForUri` from @shared, passed in so this stays testable. */
  getDownloadersForUri: (uri: string) => Downloader[]
): { downloader: Downloader; uri: string } | null => {
  const unavailable = new Set(repack.unavailableUris ?? []);
  const options: { downloader: Downloader; uri: string }[] = [];
  for (const uri of repack.uris) {
    if (unavailable.has(uri)) continue;
    for (const downloader of getDownloadersForUri(uri)) {
      if (isConfigured(downloader, tokens)) options.push({ downloader, uri });
    }
  }
  if (options.length === 0) return null;

  for (const downloader of PREFERRED) {
    const option = options.find(
      (candidate) => candidate.downloader === downloader
    );
    if (option) return option;
  }
  return options[0];
};
