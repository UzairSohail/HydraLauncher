import { registerEvent } from "../register-event";
import type { Download, StartGameDownloadPayload } from "@types";
import {
  DownloadManager,
  DownloadOrchestrator,
  HydraApi,
  logger,
} from "@main/services";
import { createGame } from "@main/services/library-sync";
import { GameUpdates } from "@main/services/game-updates";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { DownloadError, isBlockedTorrentDownload, parseBytes } from "@shared";
import {
  getGlobalTrackers,
  getMultipartDownloadParts,
  handleDownloadError,
  isKnownDownloadError,
  prepareGameEntry,
} from "@main/helpers";

const addGameToQueue = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: StartGameDownloadPayload
) => {
  const {
    objectId,
    title,
    shop,
    downloadPath,
    downloader,
    uri,
    parts,
    automaticallyExtract,
    automaticallyDeleteArchiveFiles,
    fileSize,
    fileIndices,
    selectedFilesSize,
    repack,
    replaceInstalledVersion,
  } = payload;

  const parsedFileSize = parseBytes(fileSize ?? null);
  const gameKey = levelKeys.game(shop, objectId);
  let download: Download;
  let didWriteDownload = false;
  let setAside = false;

  try {
    if (isBlockedTorrentDownload(downloader, uri)) {
      throw new Error(DownloadError.TorrentRequiresDebrid);
    }
    const globalTrackers = await getGlobalTrackers();

    download = {
      shop,
      objectId,
      status: "paused",
      progress: 0,
      bytesDownloaded: 0,
      downloadPath,
      downloader,
      uri,
      parts: await getMultipartDownloadParts(uri, parts, downloader),
      folderName: null,
      fileSize: selectedFilesSize ?? parsedFileSize,
      shouldSeed: false,
      timestamp: Date.now(),
      queued: false,
      pinnedToHero: false,
      extracting: false,
      automaticallyExtract,
      automaticallyDeleteArchiveFiles,
      fileIndices,
      selectedFilesSize,
      customTrackers: globalTrackers,
    };

    if (!DownloadOrchestrator.preparesRealDebridInBackground(download)) {
      await DownloadOrchestrator.validateDownloadOrMarkPending(download);
    }
    if (replaceInstalledVersion) {
      setAside = await GameUpdates.setAsideInstalledVersion(shop, objectId);
    }
    await prepareGameEntry({ gameKey, title, objectId, shop });
    if (repack) {
      await GameUpdates.recordInstalledRepack(shop, objectId, repack);
    }
    await DownloadManager.cancelDownload(gameKey).catch(() => null);
  } catch (err: unknown) {
    if (setAside) {
      await GameUpdates.restorePreviousVersion(shop, objectId).catch(
        () => null
      );
    }
    if (isKnownDownloadError(err)) {
      logger.warn(
        "Failed to validate download URL for queue with expected download error",
        err
      );
    } else {
      logger.error("Failed to validate download URL for queue", err);
    }
    return handleDownloadError(err, downloader);
  }

  try {
    await downloadsSublevel.put(gameKey, download);
    didWriteDownload = true;
    await DownloadOrchestrator.enqueuePreparedDownload(download);

    const updatedGame = await gamesSublevel.get(gameKey);

    await Promise.all([
      createGame(updatedGame!).catch(() => {}),
      HydraApi.post(`/games/${shop}/${objectId}/download`, null, {
        needsAuth: false,
      }).catch(() => {}),
    ]);

    return { ok: true };
  } catch (err: unknown) {
    if (didWriteDownload) {
      await DownloadManager.cancelDownload(gameKey).catch(() => null);
      await downloadsSublevel.del(gameKey).catch(() => null);
      await DownloadOrchestrator.syncAfterDownloadRemoved({ shop, objectId });
    }
    if (setAside) {
      await GameUpdates.restorePreviousVersion(shop, objectId).catch(
        () => null
      );
    }

    logger.error("Failed to add game to queue", err);

    if (err instanceof Error) {
      return { ok: false, error: err.message };
    }

    return { ok: false };
  }
};

registerEvent("addGameToQueue", addGameToQueue);
