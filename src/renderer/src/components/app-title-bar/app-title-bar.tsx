import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import {
  DashIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  VideoIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { MAIN_WINDOW_TITLE_BAR_HEIGHT } from "@shared";
import { useToast } from "@renderer/hooks";
import type { AppUpdaterEvent } from "@types";

import { releasesPageUrl } from "../header/auto-update-sub-header";

import { NavigationArrows } from "../navigation-arrows/navigation-arrows";
import { TitleBarSearch } from "./title-bar-search";
import "./app-title-bar.scss";
import "./title-bar-search.scss";

const titleBarStyle = {
  "--title-bar-height": `${MAIN_WINDOW_TITLE_BAR_HEIGHT}px`,
} as CSSProperties;

type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "downloading"; percent: number | null }
  | { phase: "ready" };

/**
 * Drives the version badge: a click checks Nacho's own GitHub releases, and
 * the badge then follows the download until the update is ready to install.
 */
function useUpdateCheck() {
  const { t } = useTranslation("header");
  const { showSuccessToast, showErrorToast, showWarningToast } = useToast();
  const [state, setState] = useState<UpdateState>({ phase: "idle" });

  useEffect(() => {
    return window.electron.onAutoUpdaterEvent((event: AppUpdaterEvent) => {
      if (event.type === "download-progress") {
        setState((prev) =>
          prev.phase === "ready"
            ? prev
            : { phase: "downloading", percent: event.percent }
        );
      }

      if (event.type === "update-downloaded") {
        setState({ phase: "ready" });
      }
    });
  }, []);

  const checkForUpdates = useCallback(async () => {
    if (state.phase === "ready") {
      window.electron.restartAndInstallUpdate();
      return;
    }

    if (state.phase !== "idle") return;

    setState({ phase: "checking" });

    const result = await window.electron
      .checkForUpdatesManually()
      .catch((error: unknown) => ({
        status: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      }));

    switch (result.status) {
      case "up-to-date":
        setState({ phase: "idle" });
        showSuccessToast(
          t("update_check_up_to_date"),
          t("update_check_up_to_date_description", { version: result.version })
        );
        break;
      case "update-available":
        if (result.isAutoInstallAvailable) {
          setState((prev) =>
            prev.phase === "checking"
              ? { phase: "downloading", percent: null }
              : prev
          );
          showSuccessToast(
            t("update_check_downloading", { version: result.version }),
            t("update_check_downloading_description")
          );
        } else {
          setState({ phase: "idle" });
          showSuccessToast(
            t("update_check_available", { version: result.version }),
            t("update_check_available_description")
          );
          window.electron.openExternal(releasesPageUrl);
        }
        break;
      case "update-downloaded":
        setState({ phase: "ready" });
        showSuccessToast(
          t("update_check_ready", { version: result.version }),
          t("update_check_ready_description")
        );
        break;
      case "not-packaged":
        setState({ phase: "idle" });
        showWarningToast(t("update_check_not_packaged"));
        break;
      case "error":
        setState({ phase: "idle" });
        showErrorToast(t("update_check_failed"), result.message);
        break;
    }
  }, [state.phase, t, showSuccessToast, showErrorToast, showWarningToast]);

  return { state, checkForUpdates };
}

export interface AppTitleBarProps {
  hasActiveSubscription: boolean;
  version: string;
  isWindowMaximized: boolean;
}

/**
 * The main window's only bar: brand and version over the sidebar, back and
 * forward where the pages start, search in the middle, and the window
 * controls each platform needs.
 */
export function AppTitleBar({
  hasActiveSubscription,
  version,
  isWindowMaximized,
}: Readonly<AppTitleBarProps>) {
  const { t } = useTranslation(["header", "sidebar"]);
  const { state: updateState, checkForUpdates } = useUpdateCheck();

  const versionLabel = (() => {
    switch (updateState.phase) {
      case "checking":
        return t("update_check_checking");
      case "downloading":
        return updateState.percent == null
          ? t("update_check_downloading_short")
          : t("update_check_downloading_percent", {
              percent: Math.floor(updateState.percent),
            });
      case "ready":
        return t("update_check_restart");
      default:
        return `v${version}`;
    }
  })();

  const { platform, hasNativeWindowDecorations } = window.electron;

  // The system draws the window frame and title on macOS and on Linux with
  // native decorations, so only Hydra's own frame shows the name.
  const hasCustomFrame =
    platform === "win32" ||
    (platform === "linux" && !hasNativeWindowDecorations);
  const hasCustomWindowControls =
    platform === "linux" && !hasNativeWindowDecorations;

  return (
    <header
      className={cn("title-bar", {
        "title-bar--windows": platform === "win32",
        "title-bar--darwin": platform === "darwin",
      })}
      style={titleBarStyle}
    >
      <div className="title-bar__brand">
        {hasCustomFrame && (
          <h4>
            Nacho
            {hasActiveSubscription && (
              <span className="title-bar__cloud-text"> Cloud</span>
            )}
          </h4>
        )}

        {version && (
          <button
            type="button"
            className={cn("title-bar__version", {
              "title-bar__version--busy":
                updateState.phase === "checking" ||
                updateState.phase === "downloading",
              "title-bar__version--ready": updateState.phase === "ready",
            })}
            onClick={checkForUpdates}
            title={
              updateState.phase === "ready"
                ? t("update_check_restart_tooltip")
                : t("update_check_tooltip", { version })
            }
          >
            {versionLabel}
          </button>
        )}
      </div>

      <NavigationArrows className="title-bar__navigation" />

      <div className="title-bar__search">
        <TitleBarSearch />
      </div>

      <button
        type="button"
        className="title-bar__big-picture"
        onClick={() => window.electron.openBigPictureWindow()}
      >
        <VideoIcon size={14} />
        {t("big_picture", { ns: "sidebar" })}
      </button>

      {hasCustomWindowControls && (
        <div className="title-bar__window-controls">
          <button
            type="button"
            className="title-bar__window-control"
            onClick={() => window.electron.minimizeMainWindow()}
            title={t("minimize")}
            aria-label={t("minimize")}
          >
            <DashIcon size={16} />
          </button>
          <button
            type="button"
            className="title-bar__window-control"
            onClick={() => window.electron.toggleMaximizeMainWindow()}
            title={isWindowMaximized ? t("restore") : t("maximize")}
            aria-label={isWindowMaximized ? t("restore") : t("maximize")}
          >
            {isWindowMaximized ? (
              <ScreenNormalIcon size={16} />
            ) : (
              <ScreenFullIcon size={16} />
            )}
          </button>
          <button
            type="button"
            className="title-bar__window-control title-bar__window-control--close"
            onClick={() => window.electron.closeMainWindow()}
            title={t("close")}
            aria-label={t("close")}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}
    </header>
  );
}
