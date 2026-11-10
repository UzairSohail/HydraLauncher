import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useAppSelector, useToast } from "@renderer/hooks";

/**
 * Says what automatic cloud save syncs did, so a save that wasn't downloaded
 * before a game started never goes unnoticed.
 */
export function usePersonalCloudSyncToasts() {
  const { t } = useTranslation("personal_cloud");
  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();
  const library = useAppSelector((state) => state.library.value);
  const libraryRef = useRef(library);
  libraryRef.current = library;

  useEffect(
    () =>
      window.electron.onPersonalCloudSync((event) => {
        // The Cloud saves panel reports its own Sync now result.
        if (event.phase === "manual") return;
        const title =
          libraryRef.current.find(
            (game) =>
              game.shop === event.shop && game.objectId === event.objectId
          )?.title ?? event.objectId;

        if (event.error) {
          showErrorToast(
            t("sync_failed_toast", { title }),
            event.error === "pre_launch_timeout"
              ? t("pre_launch_slow")
              : event.error
          );
          return;
        }
        switch (event.result?.outcome) {
          case "pulled":
            showSuccessToast(t("synced_toast_pulled", { title }));
            break;
          case "pushed":
            showSuccessToast(t("synced_toast_pushed", { title }));
            break;
          case "offline":
            showWarningToast(
              t("sync_failed_toast", { title }),
              t("status_offline")
            );
            break;
        }
      }),
    [t, showSuccessToast, showErrorToast, showWarningToast]
  );
}
