import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloudIcon } from "@phosphor-icons/react";

import { Button } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { PersonalCloudStatus } from "@types";

import { SettingsIntegrationCard } from "./settings-integration-card";

/** Google Drive sign-in for cloud saves, shared with Cloud Save Manager. */
export function SettingsPersonalCloud() {
  const { t } = useTranslation("personal_cloud");
  const { showErrorToast } = useToast();
  const [status, setStatus] = useState<PersonalCloudStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.electron.getPersonalCloudStatus());
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = async () => {
    setIsWorking(true);
    try {
      setStatus(await window.electron.signInPersonalCloud());
    } catch {
      showErrorToast(t("sign_in_failed"));
    } finally {
      setIsWorking(false);
    }
  };

  const togglePaused = async () => {
    if (!status) return;
    setIsWorking(true);
    try {
      setStatus(await window.electron.setPersonalCloudPaused(!status.paused));
    } finally {
      setIsWorking(false);
    }
  };

  const getStatusLabel = () => {
    if (!status?.signedIn) return t("signed_out");
    return status.paused ? t("paused") : t("signed_in");
  };

  const getStatusTone = () => {
    if (!status?.signedIn) return "neutral" as const;
    return status.paused ? ("warning" as const) : ("success" as const);
  };

  const renderActions = () => {
    if (!status?.signedIn) {
      return (
        <Button onClick={signIn} disabled={isWorking}>
          {isWorking ? t("signing_in") : t("sign_in")}
        </Button>
      );
    }
    return (
      <Button theme="outline" onClick={togglePaused} disabled={isWorking}>
        {status.paused ? t("resume") : t("pause")}
      </Button>
    );
  };

  return (
    <SettingsIntegrationCard
      title={t("integration_title")}
      logo={<CloudIcon size={20} weight="fill" />}
      status={getStatusLabel()}
      statusTone={getStatusTone()}
      actions={renderActions()}
      loading={isLoading}
    >
      <p className="settings-integration-card__meta">
        {t("integration_description")}
      </p>
      {status?.signedIn && (
        <p className="settings-integration-card__meta">{t("pause_note")}</p>
      )}
    </SettingsIntegrationCard>
  );
}
