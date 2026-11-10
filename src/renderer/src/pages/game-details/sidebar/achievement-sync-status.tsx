import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AlertIcon, CheckIcon, SyncIcon } from "@primer/octicons-react";

import type { AchievementSyncStatus as SyncStatus } from "@types";

/**
 * Says whether this game's achievements sync to the user's other devices
 * through Google Drive. Replaces Hydra's "won't sync with your account"
 * warning, which needed a Hydra subscription.
 */
export function AchievementSyncStatus() {
  const { t } = useTranslation("game_details");
  const navigate = useNavigate();
  const [status, setStatus] = useState<SyncStatus | null>(null);

  useEffect(() => {
    let active = true;
    window.electron
      .getAchievementSyncStatus()
      .then((next) => active && setStatus(next))
      .catch(() => undefined);
    const unsubscribe = window.electron.onAchievementSyncStatus(setStatus);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!status) return null;

  if (!status.signedIn) {
    return (
      <button
        type="button"
        className="subscription-required-button"
        onClick={() => navigate("/settings?tab=integrations")}
      >
        <AlertIcon size={14} />
        <span>{t("achievements_drive_sign_in")}</span>
      </button>
    );
  }

  if (status.syncing) {
    return (
      <p className="achievement-sync-status">
        <SyncIcon size={14} />
        <span>{t("achievements_drive_syncing")}</span>
      </p>
    );
  }

  if (status.lastError) {
    return (
      <button
        type="button"
        className="subscription-required-button"
        title={status.lastError.detail}
        onClick={() => {
          void window.electron.syncAchievementsNow().then(setStatus);
        }}
      >
        <AlertIcon size={14} />
        <span>{t("achievements_drive_failed")}</span>
      </button>
    );
  }

  return (
    <p className="achievement-sync-status">
      <CheckIcon size={14} />
      <span>{t("achievements_drive_synced")}</span>
    </p>
  );
}
