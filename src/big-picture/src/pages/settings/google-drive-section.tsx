import "./integration-provider-section.scss";

import type {
  PersonalCloudStatus,
  SettingsSyncError,
  SettingsSyncStatus,
} from "@types";
import { ArrowsClockwiseIcon, CloudIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Checkbox, VerticalFocusGroup } from "../../components";
import { useBigPictureToast } from "../../hooks";
import type { FocusOverrideTarget, FocusOverrides } from "../../services";
import {
  GOOGLE_DRIVE_CLOUD_SAVES_BUTTON_ID,
  GOOGLE_DRIVE_SECTION_REGION_ID,
  GOOGLE_DRIVE_SYNC_BUTTON_ID,
  GOOGLE_DRIVE_SYNC_CHECKBOX_ID,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";

const SETTINGS_TOAST_OPTIONS = {
  fallbackVisual: "settings" as const,
};

interface GoogleDriveSectionProps {
  upTarget: FocusOverrideTarget;
  downTarget: FocusOverrideTarget;
}

/**
 * Google Drive cloud saves and settings sync, the same controls as the
 * desktop Integrations page, so Big Picture doesn't have to be left for them.
 */
export function GoogleDriveSection({
  upTarget,
  downTarget,
}: Readonly<GoogleDriveSectionProps>) {
  const { t } = useTranslation("personal_cloud");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [cloudStatus, setCloudStatus] = useState<PersonalCloudStatus | null>(
    null
  );
  const [syncStatus, setSyncStatus] = useState<SettingsSyncStatus | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isTogglingPause, setIsTogglingPause] = useState(false);

  const refresh = useCallback(async () => {
    const electron = globalThis.window.electron;
    const [nextCloud, nextSync] = await Promise.all([
      electron.getPersonalCloudStatus().catch(() => null),
      electron.getSettingsSyncStatus().catch(() => null),
    ]);
    setCloudStatus(nextCloud);
    setSyncStatus(nextSync);
  }, []);

  useEffect(() => {
    void refresh();
    return globalThis.window.electron.onSettingsSyncStatus(setSyncStatus);
  }, [refresh]);

  const describeError = (error: SettingsSyncError) =>
    t(`settings_sync_reason_${error.reason}`, { detail: error.detail });

  const signIn = async () => {
    setIsSigningIn(true);
    try {
      setCloudStatus(await globalThis.window.electron.signInPersonalCloud());
      showSuccessToast(t("signed_in"), SETTINGS_TOAST_OPTIONS);
    } catch {
      showErrorToast(t("sign_in_failed"), SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsSigningIn(false);
      void refresh();
    }
  };

  const togglePaused = async () => {
    if (!cloudStatus) return;
    setIsTogglingPause(true);
    try {
      setCloudStatus(
        await globalThis.window.electron.setPersonalCloudPaused(
          !cloudStatus.paused
        )
      );
    } finally {
      setIsTogglingPause(false);
    }
  };

  const toggleSync = async (enabled: boolean) => {
    setSyncStatus(
      await globalThis.window.electron.setSettingsSyncEnabled(enabled)
    );
  };

  const syncNow = async () => {
    const next = await globalThis.window.electron.syncSettingsNow();
    setSyncStatus(next);
    if (next.lastError) {
      showErrorToast(t("settings_sync_failed"), {
        ...SETTINGS_TOAST_OPTIONS,
        message: describeError(next.lastError),
      });
    }
  };

  const signedIn = Boolean(cloudStatus?.signedIn);
  const syncEnabled = Boolean(signedIn && syncStatus?.enabled);
  const syncNeedsSignIn =
    syncStatus?.lastError?.reason === "sign_in_expired" ||
    syncStatus?.lastError?.reason === "sign_in_rejected";

  // Only the controls that are on screen take part in the focus chain.
  const focusIds = useMemo(() => {
    const ids = [GOOGLE_DRIVE_CLOUD_SAVES_BUTTON_ID];
    if (signedIn) ids.push(GOOGLE_DRIVE_SYNC_CHECKBOX_ID);
    if (syncEnabled) ids.push(GOOGLE_DRIVE_SYNC_BUTTON_ID);
    return ids;
  }, [signedIn, syncEnabled]);

  const overridesFor = (focusId: string): FocusOverrides => {
    const index = focusIds.indexOf(focusId);
    const previous = focusIds[index - 1];
    const next = focusIds[index + 1];
    return {
      up: previous ? { type: "item", itemId: previous } : upTarget,
      down: next ? { type: "item", itemId: next } : downTarget,
    };
  };

  const cloudStatusLabel = !signedIn
    ? t("signed_out")
    : cloudStatus?.paused
      ? t("paused")
      : t("signed_in");

  const syncStatusLabel = (() => {
    if (!syncStatus?.enabled) return t("settings_sync_off");
    if (syncStatus.syncing) return t("settings_sync_syncing");
    return syncStatus.lastError
      ? t("settings_sync_error")
      : t("settings_sync_on");
  })();

  return (
    <SettingsSection
      title="Google Drive"
      description={t("integration_description")}
      className="integration-provider-section"
    >
      <VerticalFocusGroup regionId={GOOGLE_DRIVE_SECTION_REGION_ID} asChild>
        <div className="integration-provider-section__content">
          <p className="integration-provider-section__helper">
            <CloudIcon size={16} weight="fill" /> {t("title")}:{" "}
            {cloudStatusLabel}
          </p>

          {signedIn ? (
            <Button
              variant="secondary"
              loading={isTogglingPause}
              focusId={GOOGLE_DRIVE_CLOUD_SAVES_BUTTON_ID}
              focusNavigationOverrides={overridesFor(
                GOOGLE_DRIVE_CLOUD_SAVES_BUTTON_ID
              )}
              onClick={togglePaused}
            >
              {cloudStatus?.paused ? t("resume") : t("pause")}
            </Button>
          ) : (
            <Button
              loading={isSigningIn}
              focusId={GOOGLE_DRIVE_CLOUD_SAVES_BUTTON_ID}
              focusNavigationOverrides={overridesFor(
                GOOGLE_DRIVE_CLOUD_SAVES_BUTTON_ID
              )}
              onClick={signIn}
            >
              {isSigningIn ? t("signing_in") : t("sign_in")}
            </Button>
          )}

          {signedIn ? (
            <>
              <p className="integration-provider-section__helper">
                <ArrowsClockwiseIcon size={16} weight="bold" />{" "}
                {t("settings_sync_title")}: {syncStatusLabel}
              </p>

              <Checkbox
                id="google-drive-settings-sync"
                label={t("settings_sync_enabled")}
                checked={Boolean(syncStatus?.enabled)}
                focusId={GOOGLE_DRIVE_SYNC_CHECKBOX_ID}
                navigationOverrides={overridesFor(
                  GOOGLE_DRIVE_SYNC_CHECKBOX_ID
                )}
                block
                onChange={(enabled) => void toggleSync(enabled)}
              />

              {syncEnabled ? (
                <Button
                  variant="secondary"
                  loading={isSigningIn || Boolean(syncStatus?.syncing)}
                  focusId={GOOGLE_DRIVE_SYNC_BUTTON_ID}
                  focusNavigationOverrides={overridesFor(
                    GOOGLE_DRIVE_SYNC_BUTTON_ID
                  )}
                  onClick={syncNeedsSignIn ? signIn : syncNow}
                >
                  {syncNeedsSignIn
                    ? t("settings_sync_sign_in_again")
                    : t("sync_now")}
                </Button>
              ) : null}

              {syncEnabled && syncStatus?.lastError && !syncStatus.syncing ? (
                <p className="integration-provider-section__helper integration-provider-section__helper--error">
                  {describeError(syncStatus.lastError)}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
