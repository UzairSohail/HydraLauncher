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

const DEBRID = new Set<Downloader>(PREFERRED);

/**
 * How sure we are that an option works, best first:
 * 0. a torrent through debrid (debrid is the only way torrents are fetched),
 * 1. a host with its own downloader, such as Gofile or Buzzheavier,
 * 2. any other hoster link handed to debrid, which the service may not
 *    support ("This host or link is not supported").
 */
const tier = (option: { downloader: Downloader; uri: string }) => {
  if (option.uri.startsWith("magnet:")) return 0;
  return DEBRID.has(option.downloader) ? 2 : 1;
};

const preference = (downloader: Downloader) => {
  const index = PREFERRED.indexOf(downloader);
  return index === -1 ? PREFERRED.length : index;
};

/**
 * Every link and downloader for a listing queued from the phone that this
 * computer can use, in the order to try them. Torrents are never downloaded
 * peer to peer, only through debrid.
 */
export const rankCompanionDownloads = (
  repack: Pick<CompanionRepack, "uris" | "unavailableUris">,
  tokens: DebridTokens | null | undefined,
  /** `getDownloadersForUri` from @shared, passed in so this stays testable. */
  getDownloadersForUri: (uri: string) => Downloader[]
): { downloader: Downloader; uri: string }[] => {
  const unavailable = new Set(repack.unavailableUris ?? []);
  const options: { downloader: Downloader; uri: string; order: number }[] = [];
  for (const uri of repack.uris) {
    if (unavailable.has(uri)) continue;
    for (const downloader of getDownloadersForUri(uri)) {
      if (isConfigured(downloader, tokens)) {
        options.push({ downloader, uri, order: options.length });
      }
    }
  }
  return options
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        preference(a.downloader) - preference(b.downloader) ||
        a.order - b.order
    )
    .map(({ downloader, uri }) => ({ downloader, uri }));
};

/** The first option `rankCompanionDownloads` would try, or null. */
export const pickCompanionDownload = (
  ...args: Parameters<typeof rankCompanionDownloads>
) => rankCompanionDownloads(...args)[0] ?? null;
