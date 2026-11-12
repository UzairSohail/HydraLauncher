import { useCallback, useState } from "react";
import {
  getDownloadersForUri,
  getRepackUriParts,
  toInstalledRepackInfo,
} from "@shared";
import type { LibraryGame, StartGameDownloadPayload } from "@types";

import {
  useAppSelector,
  useDownload,
  useFeature,
  useUserDetails,
} from "@renderer/hooks";
import {
  getDefaultDownloader,
  getDownloadOptions,
} from "@renderer/pages/game-details/modals/use-download-options";

export interface UpdateAllResult {
  started: number;
  failed: number;
}

/**
 * Starts the update for every game in the list with the same defaults the
 * download dialog would pick: the preferred debrid service, the folder the
 * game is already in and the extraction settings. The first one starts right
 * away when nothing else is downloading, and the rest are queued.
 */
export function useUpdateAllGames() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const { isFeatureEnabled } = useFeature();
  const { hasActiveSubscription } = useUserDetails();
  const { startDownload, addGameToQueue, lastPacket } = useDownload();
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);

  const updateAll = useCallback(
    async (games: LibraryGame[]): Promise<UpdateAllResult> => {
      setIsUpdatingAll(true);
      const result: UpdateAllResult = { started: 0, failed: 0 };
      let isDownloading = lastPacket !== null;

      try {
        const defaultPath =
          userPreferences?.downloadsPath ??
          (await window.electron.getDefaultDownloadsPath());

        for (const game of games) {
          try {
            const repack = await window.electron.getGameUpdateRepack(
              game.shop,
              game.objectId
            );
            if (!repack) {
              result.failed++;
              continue;
            }

            const available = getDownloadOptions(repack, {
              userPreferences,
              hasActiveSubscription,
              isFeatureEnabled,
            })
              .filter((option) => option.isAvailable)
              .map((option) => option.downloader);
            const downloader = getDefaultDownloader(available);
            const uri =
              downloader === null
                ? undefined
                : repack.uris.find((candidate) =>
                    getDownloadersForUri(candidate).includes(downloader)
                  );
            if (downloader === null || !uri) {
              result.failed++;
              continue;
            }

            const payload: StartGameDownloadPayload = {
              objectId: game.objectId,
              shop: game.shop,
              title: game.title,
              downloader,
              downloadPath: game.download?.downloadPath ?? defaultPath,
              uri,
              parts: getRepackUriParts(repack, uri),
              automaticallyExtract:
                userPreferences?.extractFilesByDefault ?? true,
              automaticallyDeleteArchiveFiles:
                userPreferences?.deleteArchiveFilesAfterExtractionByDefault ??
                true,
              fileSize: repack.fileSize,
              repack: toInstalledRepackInfo(repack, uri),
              replaceInstalledVersion: true,
            };

            const response = isDownloading
              ? await addGameToQueue(payload)
              : await startDownload(payload);

            if (response.ok) {
              result.started++;
              isDownloading = true;
            } else {
              result.failed++;
            }
          } catch {
            result.failed++;
          }
        }
      } finally {
        setIsUpdatingAll(false);
      }

      return result;
    },
    [
      userPreferences,
      hasActiveSubscription,
      isFeatureEnabled,
      startDownload,
      addGameToQueue,
      lastPacket,
    ]
  );

  return { updateAll, isUpdatingAll };
}
