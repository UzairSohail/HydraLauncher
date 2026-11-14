import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "../modal/modal";
import { Button } from "../button/button";
import { setUserPreferences } from "@renderer/features";
import { useAppDispatch, useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";

import "./start-with-computer-prompt.scss";

const STORAGE_KEY = "nacho-start-with-computer-prompt-dismissed";

const hasDismissed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

const markDismissed = () => {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Not critical: the prompt may show once more.
  }
};

/**
 * Downloads queued from Nacho Companion only start while the launcher is
 * running. Once this device is signed in to Google (so the phone can reach
 * it), offer once to start Nacho Launcher with the computer, minimized to
 * the tray. Not shown for the portable build, which can't auto-start, or
 * when starting with the computer is already on.
 */
export function StartWithComputerPrompt() {
  const { t } = useTranslation("personal_cloud");
  const dispatch = useAppDispatch();
  const { showSuccessToast, showErrorToast } = useToast();
  const [visible, setVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (hasDismissed() || window.electron.isPortableVersion) return;
    let cancelled = false;

    Promise.all([
      window.electron.getUserPreferences(),
      window.electron.getPersonalCloudStatus(),
    ])
      .then(([preferences, status]) => {
        if (cancelled) return;
        if (preferences?.runAtStartup) {
          markDismissed();
          return;
        }
        // Not signed in yet: the Google sign-in prompt comes first, and this
        // one shows on a later launch once the phone can reach this device.
        if (status.signedIn) setVisible(true);
      })
      .catch(() => {
        // Google sign-in isn't available in this build; stay quiet.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    markDismissed();
    setVisible(false);
  };

  const enable = async () => {
    setIsSaving(true);
    try {
      await window.electron.updateUserPreferences({
        runAtStartup: true,
        startMinimized: true,
      });
      await window.electron.autoLaunch({ enabled: true, minimized: true });
      dispatch(setUserPreferences(await window.electron.getUserPreferences()));
      showSuccessToast(t("start_with_computer_enabled"));
      close();
    } catch (error) {
      logger.error("Failed to turn on starting with the computer", error);
      showErrorToast(t("start_with_computer_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("start_with_computer_title")}
      onClose={close}
      clickOutsideToClose={false}
    >
      <div className="start-with-computer-prompt">
        <p>{t("start_with_computer_body")}</p>
        <p className="start-with-computer-prompt__note">
          {t("start_with_computer_note")}
        </p>

        <div className="start-with-computer-prompt__actions">
          <Button theme="outline" onClick={close} disabled={isSaving}>
            {t("first_run_later")}
          </Button>
          <Button theme="primary" onClick={enable} disabled={isSaving}>
            {t("start_with_computer_enable")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
