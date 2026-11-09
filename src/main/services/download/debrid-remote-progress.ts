import type { Download } from "@types";
import { Downloader } from "@shared";
import { logger } from "../logger";
import { AllDebridClient } from "./all-debrid";
import { PremiumizeClient } from "./premiumize";
import { RealDebridClient } from "./real-debrid";
import { TorBoxClient } from "./torbox";

/**
 * How far the debrid provider has got downloading an uncached magnet into its
 * own cloud, from 0 to 1. Returns null when the provider does not report it.
 */
export async function getDebridRemoteProgress(
  download: Download,
  signal?: AbortSignal
): Promise<number | null> {
  if (!download.uri.startsWith("magnet:")) return null;
  try {
    switch (download.downloader) {
      case Downloader.RealDebrid:
        return download.realDebridTorrentId
          ? await RealDebridClient.getRemoteProgress(
              download.realDebridTorrentId,
              signal
            )
          : null;
      case Downloader.TorBox:
        return await TorBoxClient.getRemoteProgress(download.uri);
      case Downloader.Premiumize:
        return await PremiumizeClient.getRemoteProgress(download.uri);
      case Downloader.AllDebrid:
        return await AllDebridClient.getRemoteProgress(download.uri);
      default:
        return null;
    }
  } catch (error) {
    logger.warn("[Debrid] Could not read remote download progress", error);
    return null;
  }
}
