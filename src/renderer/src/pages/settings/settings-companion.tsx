import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DeviceMobileIcon } from "@phosphor-icons/react";

import { CheckboxField, TextField } from "@renderer/components";
import type { CompanionLinkStatus } from "@types";

import {
  SettingsIntegrationCard,
  SettingsIntegrationLastSynced,
} from "./settings-integration-card";

/** Lets the Nacho Companion phone app see this computer and queue downloads on it. */
export function SettingsCompanion() {
  const { t } = useTranslation("personal_cloud");
  const [status, setStatus] = useState<CompanionLinkStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await window.electron.getCompanionLinkStatus();
      setStatus(next);
      setName(next.deviceName);
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleEnabled = async () => {
    if (!status) return;
    setStatus(await window.electron.setCompanionLinkEnabled(!status.enabled));
  };

  const saveName = async () => {
    if (!status || name.trim() === status.deviceName) return;
    const next = await window.electron.setCompanionDeviceName(name);
    setStatus(next);
    setName(next.deviceName);
  };

  const getStatusLabel = () => {
    if (!status?.signedIn) return t("settings_sync_needs_sign_in");
    if (!status.enabled) return t("companion_off");
    return status.lastError ? t("settings_sync_error") : t("companion_on");
  };

  const getStatusTone = () => {
    if (!status?.signedIn || !status.enabled) return "neutral" as const;
    return status.lastError ? ("warning" as const) : ("success" as const);
  };

  return (
    <SettingsIntegrationCard
      title={t("companion_title")}
      logo={<DeviceMobileIcon size={20} weight="bold" />}
      status={getStatusLabel()}
      statusTone={getStatusTone()}
      loading={isLoading}
    >
      <p className="settings-integration-card__meta">
        {t("companion_description")}
      </p>
      {status?.signedIn && (
        <>
          <TextField
            label={t("companion_device_name")}
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveName}
            onKeyDown={(event) => {
              if (event.key === "Enter") void saveName();
            }}
          />
          <CheckboxField
            label={t("companion_enabled")}
            checked={status.enabled}
            onChange={toggleEnabled}
          />
          {status.lastError && (
            <p className="settings-integration-card__meta settings-integration-card__meta--error">
              {status.lastError}
            </p>
          )}
          <SettingsIntegrationLastSynced
            lastSyncedAt={
              status.lastCheckedAt
                ? new Date(status.lastCheckedAt).toISOString()
                : null
            }
          />
        </>
      )}
    </SettingsIntegrationCard>
  );
}
