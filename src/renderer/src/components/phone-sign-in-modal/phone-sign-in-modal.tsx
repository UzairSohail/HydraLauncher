import { useTranslation } from "react-i18next";

import type { PersonalCloudStatus } from "@types";
import { phoneSignInQrSource, usePhoneSignIn } from "@renderer/hooks";

import { Modal } from "../modal/modal";
import { Button } from "../button/button";

import "./phone-sign-in-modal.scss";

export interface PhoneSignInModalProps {
  visible: boolean;
  onClose: () => void;
  onSignedIn: (status: PersonalCloudStatus) => void;
}

/** Google sign-in by scanning a QR code with a phone, for handhelds. */
export function PhoneSignInModal({
  visible,
  onClose,
  onSignedIn,
}: Readonly<PhoneSignInModalProps>) {
  const { t } = useTranslation("personal_cloud");
  const { state, retry } = usePhoneSignIn(visible, onSignedIn);

  return (
    <Modal
      visible={visible}
      title={t("phone_sign_in_title")}
      onClose={onClose}
      clickOutsideToClose={false}
    >
      <div className="phone-sign-in">
        {state.step === "starting" && (
          <p className="phone-sign-in__muted">{t("phone_sign_in_starting")}</p>
        )}

        {state.step === "waiting" && (
          <>
            <img
              className="phone-sign-in__qr"
              src={phoneSignInQrSource(state.code)}
              alt=""
            />
            <ol className="phone-sign-in__steps">
              <li>
                {t("phone_sign_in_step_scan", {
                  url: state.code.verificationUrl.replace(/^https?:\/\//, ""),
                })}
              </li>
              <li>{t("phone_sign_in_step_code")}</li>
            </ol>
            <code className="phone-sign-in__code">{state.code.userCode}</code>
            <p className="phone-sign-in__muted">{t("phone_sign_in_waiting")}</p>
          </>
        )}

        {state.step === "failed" && (
          <>
            <p>{t("phone_sign_in_failed")}</p>
            {state.message && (
              <p className="phone-sign-in__muted">{state.message}</p>
            )}
          </>
        )}

        <div className="phone-sign-in__actions">
          <Button theme="outline" onClick={onClose}>
            {t("phone_sign_in_cancel")}
          </Button>
          {state.step === "failed" && (
            <Button theme="primary" onClick={retry}>
              {t("phone_sign_in_retry")}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
