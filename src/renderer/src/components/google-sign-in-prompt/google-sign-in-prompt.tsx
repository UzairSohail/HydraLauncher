import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "../modal/modal";
import { Button } from "../button/button";
import { PhoneSignInModal } from "../phone-sign-in-modal/phone-sign-in-modal";
import { useToast } from "@renderer/hooks";

import "./google-sign-in-prompt.scss";

const STORAGE_KEY = "nacho-google-sign-in-prompt-dismissed";

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
 * Shown once on first launch when this device isn't signed in to Google,
 * so a new user finds the sign-in that powers cloud saves, settings sync,
 * achievement sync and Nacho Companion. Each Google account uses its own
 * Drive, so friends sharing the app never see each other's data.
 */
export function GoogleSignInPrompt() {
  const { t } = useTranslation("personal_cloud");
  const { showSuccessToast, showErrorToast } = useToast();
  const [visible, setVisible] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [phoneSignInAvailable, setPhoneSignInAvailable] = useState(false);
  const [showPhoneSignIn, setShowPhoneSignIn] = useState(false);

  useEffect(() => {
    if (hasDismissed()) return;
    let cancelled = false;
    window.electron
      .getPersonalCloudStatus()
      .then((status) => {
        if (cancelled) return;
        if (status.signedIn) {
          // Already set up (e.g. an existing user): never prompt.
          markDismissed();
        } else {
          setPhoneSignInAvailable(status.phoneSignInAvailable);
          setVisible(true);
        }
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

  const signIn = async () => {
    setIsSigningIn(true);
    try {
      const status = await window.electron.signInPersonalCloud();
      if (status.signedIn) {
        showSuccessToast(t("first_run_signed_in"));
        close();
      } else {
        showErrorToast(t("sign_in_failed"));
      }
    } catch {
      showErrorToast(t("sign_in_failed"));
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <>
      <Modal
        visible={visible && !showPhoneSignIn}
        title={t("first_run_title")}
        onClose={close}
        clickOutsideToClose={false}
      >
        <div className="google-sign-in-prompt">
          <p>{t("first_run_body")}</p>
          <ul className="google-sign-in-prompt__list">
            <li>{t("first_run_saves")}</li>
            <li>{t("first_run_settings")}</li>
            <li>{t("first_run_companion")}</li>
          </ul>
          <p className="google-sign-in-prompt__note">
            {t("first_run_privacy")}
          </p>

          <div className="google-sign-in-prompt__actions">
            <Button theme="outline" onClick={close} disabled={isSigningIn}>
              {t("first_run_later")}
            </Button>
            {phoneSignInAvailable && (
              <Button
                theme="outline"
                onClick={() => setShowPhoneSignIn(true)}
                disabled={isSigningIn}
              >
                {t("phone_sign_in")}
              </Button>
            )}
            <Button theme="primary" onClick={signIn} disabled={isSigningIn}>
              {isSigningIn ? t("signing_in") : t("sign_in")}
            </Button>
          </div>
        </div>
      </Modal>

      <PhoneSignInModal
        visible={visible && showPhoneSignIn}
        onClose={() => setShowPhoneSignIn(false)}
        onSignedIn={() => {
          setShowPhoneSignIn(false);
          showSuccessToast(t("first_run_signed_in"));
          close();
        }}
      />
    </>
  );
}
