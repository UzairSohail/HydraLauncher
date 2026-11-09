import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";

import { Button, CheckboxField } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { SettingsSyncStatus } from "@types";

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

  const syncNow = async () => {
    const next = await window.electron.syncSettingsNow();
    setStatus(next);
    if (next.lastError) showErrorToast(t("settings_sync_failed"));
  };

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
          <Button theme="outline" onClick={syncNow} disabled={status.syncing}>
            {t("sync_now")}
          </Button>
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
