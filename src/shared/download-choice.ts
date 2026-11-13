import { Downloader } from "./constants.js";

/** Hosts with no direct downloader that a debrid provider can still unlock. */
export const debridOnlyHosts = [
  "https://1fichier.com",
  "https://mediafire.com",
];

/** Debrid providers that unlock regular file-hoster links. */
export const hosterDebridDownloaders = [
  Downloader.AllDebrid,
  Downloader.RealDebrid,
];

/** Debrid providers in the order Nacho prefers them: AllDebrid first. */
export const DEBRID_PREFERENCE = [
  Downloader.AllDebrid,
  Downloader.RealDebrid,
  Downloader.Premiumize,
  Downloader.TorBox,
];

const DEBRID = new Set<Downloader>(DEBRID_PREFERENCE);

export const isKnownDebridHosterUri = (uri: string) =>
  debridOnlyHosts.some((host) => uri.startsWith(host));

type GetDownloadersForUri = (uri: string) => Downloader[];

/**
 * How sure we are that a downloader can fetch a link, best first:
 * 0. a torrent through debrid (debrid is the only way torrents are fetched),
 * 1. a host with its own downloader (Gofile, Buzzheavier, Pixeldrain...) or a
 *    host debrid is known to unlock (1fichier, Mediafire),
 * 2. any other hoster link handed to debrid, which the service often rejects
 *    with "This host or link is not supported".
 */
export const getUriConfidence = (
  uri: string,
  downloader: Downloader
): number => {
  if (uri.startsWith("magnet:")) return 0;
  if (!DEBRID.has(downloader)) return 1;
  if (isKnownDebridHosterUri(uri)) return 1;
  return 2;
};

const debridRank = (downloader: Downloader) => {
  const index = DEBRID_PREFERENCE.indexOf(downloader);
  return index === -1 ? DEBRID_PREFERENCE.length : index;
};

/**
 * The link of a listing to hand a downloader: the one it is most likely to
 * fetch, skipping links already known to be down when another one exists.
 */
export const pickUriForDownloader = (
  repack: { uris: string[]; unavailableUris?: string[] | null },
  downloader: Downloader,
  getDownloadersForUri: GetDownloadersForUri
): string | null =>
  rankUrisForDownloader(repack, downloader, getDownloadersForUri)[0] ?? null;

/**
 * Every link of a listing a downloader can take, best first, so a link debrid
 * rejects can be followed by the next one.
 */
export const rankUrisForDownloader = (
  repack: { uris: string[]; unavailableUris?: string[] | null },
  downloader: Downloader,
  getDownloadersForUri: GetDownloadersForUri
): string[] => {
  const unavailable = new Set(repack.unavailableUris ?? []);
  const candidates = repack.uris
    .map((uri, order) => ({ uri, order }))
    .filter(({ uri }) => getDownloadersForUri(uri).includes(downloader));

  candidates.sort(
    (a, b) =>
      Number(unavailable.has(a.uri)) - Number(unavailable.has(b.uri)) ||
      getUriConfidence(a.uri, downloader) -
        getUriConfidence(b.uri, downloader) ||
      a.order - b.order
  );

  return candidates.map(({ uri }) => uri);
};

/**
 * The downloader to preselect for a listing. A torrent goes through debrid,
 * AllDebrid first. Otherwise a host with its own downloader, or one debrid is
 * known to unlock, beats handing an unknown host to debrid, so a SteamRIP
 * style listing starts on its Gofile/Buzzheavier/Pixeldrain mirror instead of
 * failing with "This host or link is not supported".
 */
export const pickDefaultDownloader = (
  repack: { uris: string[]; unavailableUris?: string[] | null } | null,
  availableDownloaders: Downloader[],
  getDownloadersForUri: GetDownloadersForUri
): Downloader | null => {
  if (availableDownloaders.length === 0) return null;
  if (!repack) {
    return (
      [...availableDownloaders].sort(
        (a, b) => debridRank(a) - debridRank(b)
      )[0] ?? null
    );
  }

  const ranked = availableDownloaders.map((downloader, order) => {
    const uri = pickUriForDownloader(repack, downloader, getDownloadersForUri);
    return {
      downloader,
      order,
      confidence: uri ? getUriConfidence(uri, downloader) : 3,
    };
  });

  ranked.sort(
    (a, b) =>
      a.confidence - b.confidence ||
      debridRank(a.downloader) - debridRank(b.downloader) ||
      a.order - b.order
  );

  return ranked[0].downloader;
};
