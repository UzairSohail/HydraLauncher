import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";

import { Button, CheckboxField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { SettingsSyncError, SettingsSyncStatus } from "@types";

import {
  SettingsIntegrationCard,
  SettingsIntegrationLastSynced,
} from "./settings-integration-card";

/** Syncs settings, API keys, download sources and themes through Google Drive. */
export function SettingsSync() {
  const { t } = useTranslation("personal_cloud");
  const { showErrorToast } = useToast();
  const [status, setStatus] = useState<SettingsSyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.electron.getSettingsSyncStatus());
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return window.electron.onSettingsSyncStatus(setStatus);
  }, [refresh]);

  const describeError = (error: SettingsSyncError) =>
    t(`settings_sync_reason_${error.reason}`, { detail: error.detail });

  const syncNow = async () => {
    const next = await window.electron.syncSettingsNow();
    setStatus(next);
    if (next.lastError) {
      showErrorToast(t("settings_sync_failed"), describeError(next.lastError));
    }
  };

  /** Replaces a sign-in Google won't accept; signing in also runs a sync. */
  const signInAgain = async () => {
    setIsSigningIn(true);
    try {
      await window.electron.signInPersonalCloud();
    } catch {
      showErrorToast(t("sign_in_failed"));
    } finally {
      setIsSigningIn(false);
      void refresh();
    }
  };

  const needsSignIn =
    status?.lastError?.reason === "sign_in_expired" ||
    status?.lastError?.reason === "sign_in_rejected";

  const toggleEnabled = async () => {
    if (!status) return;
    setStatus(await window.electron.setSettingsSyncEnabled(!status.enabled));
  };

  const getStatusLabel = () => {
    if (!status?.signedIn) return t("settings_sync_needs_sign_in");
    if (!status.enabled) return t("settings_sync_off");
    if (status.syncing) return t("settings_sync_syncing");
    return status.lastError ? t("settings_sync_error") : t("settings_sync_on");
  };

  const getStatusTone = () => {
    if (!status?.signedIn || !status.enabled) return "neutral" as const;
    return status.lastError ? ("warning" as const) : ("success" as const);
  };

  const lastSyncedAt = status?.lastSyncedAt
    ? new Date(status.lastSyncedAt).toISOString()
    : null;

  return (
    <SettingsIntegrationCard
      title={t("settings_sync_title")}
      logo={<ArrowsClockwiseIcon size={20} weight="bold" />}
      status={getStatusLabel()}
      statusTone={getStatusTone()}
      loading={isLoading}
      actions={
        status?.signedIn && status.enabled ? (
          needsSignIn ? (
            <Button onClick={signInAgain} disabled={isSigningIn}>
              {isSigningIn ? t("signing_in") : t("settings_sync_sign_in_again")}
            </Button>
          ) : (
            <Button theme="outline" onClick={syncNow} disabled={status.syncing}>
              {t("sync_now")}
            </Button>
          )
        ) : undefined
      }
    >
      <p className="settings-integration-card__meta">
        {t("settings_sync_description")}
      </p>
      {status?.signedIn && (
        <>
          <CheckboxField
            label={t("settings_sync_enabled")}
            checked={status.enabled}
            onChange={toggleEnabled}
          />
          {status.enabled && status.lastError && !status.syncing && (
            <p className="settings-integration-card__meta settings-integration-card__meta--error">
              {describeError(status.lastError)}
            </p>
          )}
          {status.enabled && (
            <SettingsIntegrationLastSynced lastSyncedAt={lastSyncedAt} />
          )}
          {status.enabled && status.lastChangeFromDevice && (
            <p className="settings-integration-card__meta">
              {t("settings_sync_last_change_from", {
                device: status.lastChangeFromDevice.replace(
                  /-[0-9a-f]{8}$/,
                  ""
                ),
              })}
            </p>
          )}
        </>
      )}
    </SettingsIntegrationCard>
  );
}
