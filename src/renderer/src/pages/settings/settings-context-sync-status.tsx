import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@renderer/components";
import { SettingsContextConsumer } from "@renderer/context";
import type {
  PersonalCloudLastSync,
  SettingsSyncError,
  SyncOverview,
} from "@types";

import "./settings-sync-status.scss";

type Tone = "success" | "warning" | "danger" | "neutral";

interface Row {
  key: string;
  title: string;
  tone: Tone;
  label: string;
  lines: string[];
}

const ago = (at: number) => formatDistanceToNow(at, { addSuffix: true });

/**
 * One page that shows how everything synced through Google Drive is doing on
 * this computer, so a problem can be spotted without reading log files.
 */
export function SettingsContextSyncStatus() {
  const { t } = useTranslation("personal_cloud");
  const { t: tSettings } = useTranslation("settings");
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setOverview(await window.electron.getSyncOverview());
    } catch {
      setOverview(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const electron = window.electron;
    const unsubscribers = [
      electron.onSettingsSyncStatus(() => void refresh()),
      electron.onAchievementSyncStatus(() => void refresh()),
      electron.onPersonalCloudSync(() => void refresh()),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [refresh]);

  const syncAll = async () => {
    setIsSyncing(true);
    try {
      await Promise.allSettled([
        window.electron.syncSettingsNow(),
        window.electron.syncAchievementsNow(),
      ]);
    } finally {
      setIsSyncing(false);
      void refresh();
    }
  };

  const describeError = (error: SettingsSyncError) =>
    t(`settings_sync_reason_${error.reason}`, { detail: error.detail });

  const describeSave = (save: PersonalCloudLastSync) => {
    const game = save.title ?? t("status_unknown_game");
    const outcome = save.error
      ? save.error
      : save.result
        ? t(`status_outcome_${save.result.outcome}`)
        : t("status_unknown");
    return t("status_last_save_sync", { when: ago(save.at), game, outcome });
  };

  const signedIn = Boolean(overview?.google?.signedIn);

  const rows = (): Row[] => {
    if (!overview) return [];
    const { google, saves, settings, achievements, companion } = overview;
    const offRow = (key: string, title: string): Row => ({
      key,
      title,
      tone: "neutral",
      label: t("status_off"),
      lines: [],
    });

    const googleRow: Row = {
      key: "google",
      title: t("status_google"),
      tone: !google ? "neutral" : signedIn ? "success" : "warning",
      label: !google
        ? t("status_unknown")
        : signedIn
          ? google.paused
            ? t("paused")
            : t("signed_in")
          : t("signed_out"),
      lines: signedIn ? [] : [t("status_not_signed_in_hint")],
    };
    if (!signedIn) return [googleRow];

    const savesRow: Row = google?.paused
      ? { ...offRow("saves", t("status_saves")), label: t("paused") }
      : {
          key: "saves",
          title: t("status_saves"),
          tone: !saves
            ? "neutral"
            : saves.error || saves.result?.outcome === "conflict"
              ? "danger"
              : "success",
          label: !saves
            ? t("status_never")
            : saves.error || saves.result?.outcome === "conflict"
              ? t("status_problem")
              : t("status_ok"),
          lines: [saves ? describeSave(saves) : t("status_no_save_sync")],
        };

    const settingsRow: Row =
      !settings || !settings.enabled
        ? offRow("settings", t("status_settings"))
        : {
            key: "settings",
            title: t("status_settings"),
            tone: settings.lastError ? "danger" : "success",
            label: settings.syncing
              ? t("settings_sync_syncing")
              : settings.lastError
                ? t("status_problem")
                : t("status_ok"),
            lines: [
              settings.lastSyncedAt
                ? t("status_last_synced", { when: ago(settings.lastSyncedAt) })
                : t("status_never"),
              ...(settings.lastChangeFromDevice
                ? [
                    t("status_change_from", {
                      device: settings.lastChangeFromDevice,
                    }),
                  ]
                : []),
              ...(settings.lastError
                ? [describeError(settings.lastError)]
                : []),
            ],
          };

    const achievementsRow: Row = !achievements
      ? offRow("achievements", t("status_achievements"))
      : {
          key: "achievements",
          title: t("status_achievements"),
          tone: achievements.lastError ? "danger" : "success",
          label: achievements.syncing
            ? t("settings_sync_syncing")
            : achievements.lastError
              ? t("status_problem")
              : t("status_ok"),
          lines: [
            achievements.lastSyncedAt
              ? t("status_last_synced", {
                  when: ago(achievements.lastSyncedAt),
                })
              : t("status_never"),
            ...(achievements.pendingUpload ? [t("status_pending_upload")] : []),
            ...(achievements.lastError
              ? [describeError(achievements.lastError)]
              : []),
          ],
        };

    const companionRow: Row =
      !companion || !companion.enabled
        ? offRow("companion", t("status_companion"))
        : {
            key: "companion",
            title: t("status_companion"),
            tone: companion.lastError ? "danger" : "success",
            label: companion.lastError ? t("status_problem") : t("status_ok"),
            lines: [
              companion.lastCheckedAt
                ? t("status_last_checked", {
                    when: ago(companion.lastCheckedAt),
                  })
                : t("status_never"),
              t("status_this_device", { name: companion.deviceName }),
              ...(companion.lastError ? [companion.lastError] : []),
            ],
          };

    return [googleRow, savesRow, settingsRow, achievementsRow, companionRow];
  };

  return (
    <SettingsContextConsumer>
      {({ setCurrentCategoryId }) => (
        <div className="settings-context-panel sync-status">
          <div className="sync-status__header">
            <p className="sync-status__description">
              {t("status_page_description")}
            </p>
            <div className="sync-status__actions">
              <Button theme="outline" onClick={() => void refresh()}>
                {t("status_refresh")}
              </Button>
              {signedIn ? (
                <Button onClick={syncAll} disabled={isSyncing}>
                  {isSyncing
                    ? t("settings_sync_syncing")
                    : t("status_sync_all")}
                </Button>
              ) : (
                <Button onClick={() => setCurrentCategoryId("integrations")}>
                  {t("status_open_integrations")}
                </Button>
              )}
            </div>
          </div>

          <ul
            className="sync-status__list"
            aria-label={tSettings("sync_status")}
          >
            {rows().map((row) => (
              <li key={row.key} className="sync-status__row">
                <div className="sync-status__row-header">
                  <span className="sync-status__title">{row.title}</span>
                  <span
                    className={`sync-status__badge sync-status__badge--${row.tone}`}
                  >
                    {row.label}
                  </span>
                </div>
                {row.lines.map((line) => (
                  <p key={line} className="sync-status__line">
                    {line}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsContextConsumer>
  );
}
