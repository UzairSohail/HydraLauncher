import { Downloader } from "./constants.js";

/**
 * Plain peer-to-peer torrenting is disabled: a magnet can only be downloaded
 * through a debrid provider.
 */
export const isBlockedTorrentDownload = (downloader: Downloader, uri: string) =>
  downloader === Downloader.Torrent && uri.startsWith("magnet:");
