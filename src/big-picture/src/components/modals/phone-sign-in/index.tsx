import { useTranslation } from "react-i18next";

import type { PersonalCloudStatus } from "@types";
import { phoneSignInQrSource, usePhoneSignIn } from "@renderer/hooks";

import {
  Button,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../common";

import "./styles.scss";

const PHONE_SIGN_IN_CONTENT_REGION_ID = "phone-sign-in-content";
const PHONE_SIGN_IN_ACTIONS_REGION_ID = "phone-sign-in-actions";
const PHONE_SIGN_IN_CANCEL_BUTTON_ID = "phone-sign-in-cancel-button";

export interface PhoneSignInModalProps {
  visible: boolean;
  onClose: () => void;
  onSignedIn: (status: PersonalCloudStatus) => void;
}

/**
 * Google sign-in by scanning a QR code with a phone, so a handheld never
 * needs a browser or keyboard to sign in.
 */
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
      onClose={onClose}
      title={t("phone_sign_in_title")}
      initialFocusId={PHONE_SIGN_IN_CANCEL_BUTTON_ID}
      className="phone-sign-in-modal"
    >
      <VerticalFocusGroup
        regionId={PHONE_SIGN_IN_CONTENT_REGION_ID}
        className="phone-sign-in-modal__content"
      >
        {state.step === "starting" && (
          <p className="phone-sign-in-modal__muted">
            {t("phone_sign_in_starting")}
          </p>
        )}

        {state.step === "waiting" && (
          <div className="phone-sign-in-modal__body">
            <img
              className="phone-sign-in-modal__qr"
              src={phoneSignInQrSource(state.code)}
              alt=""
            />
            <div className="phone-sign-in-modal__text">
              <ol className="phone-sign-in-modal__steps">
                <li>
                  {t("phone_sign_in_step_scan", {
                    url: state.code.verificationUrl.replace(/^https?:\/\//, ""),
                  })}
                </li>
                <li>{t("phone_sign_in_step_code")}</li>
              </ol>
              <code className="phone-sign-in-modal__code">
                {state.code.userCode}
              </code>
              <p className="phone-sign-in-modal__muted">
                {t("phone_sign_in_waiting")}
              </p>
            </div>
          </div>
        )}

        {state.step === "failed" && (
          <>
            <p>{t("phone_sign_in_failed")}</p>
            {state.message && (
              <p className="phone-sign-in-modal__muted">{state.message}</p>
            )}
          </>
        )}

        <HorizontalFocusGroup
          regionId={PHONE_SIGN_IN_ACTIONS_REGION_ID}
          className="phone-sign-in-modal__actions"
        >
          <Button
            variant="secondary"
            focusId={PHONE_SIGN_IN_CANCEL_BUTTON_ID}
            onClick={onClose}
          >
            {t("phone_sign_in_cancel")}
          </Button>
          {state.step === "failed" && (
            <Button variant="primary" onClick={retry}>
              {t("phone_sign_in_retry")}
            </Button>
          )}
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
