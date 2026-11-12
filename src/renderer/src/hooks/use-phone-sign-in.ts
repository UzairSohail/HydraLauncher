import { useCallback, useEffect, useRef, useState } from "react";

import type { PersonalCloudDeviceCode, PersonalCloudStatus } from "@types";

export type PhoneSignInState =
  | { step: "starting" }
  | { step: "waiting"; code: PersonalCloudDeviceCode }
  | { step: "failed"; message: string };

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Google sign-in finished on a phone: gets a code and QR code from the main
 * process while `active`, then waits for the user to approve it. Shared by
 * the desktop and Big Picture sign-in dialogs.
 */
export function usePhoneSignIn(
  active: boolean,
  onSignedIn: (status: PersonalCloudStatus) => void
) {
  const [state, setState] = useState<PhoneSignInState>({ step: "starting" });
  const [attempt, setAttempt] = useState(0);
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const electron = window.electron;
    setState({ step: "starting" });

    (async () => {
      try {
        const code = await electron.beginPersonalCloudPhoneSignIn();
        if (cancelled) return;
        setState({ step: "waiting", code });
        const status = await electron.finishPersonalCloudPhoneSignIn();
        if (cancelled) return;
        if (status.signedIn) {
          onSignedInRef.current(status);
        } else {
          setState({ step: "failed", message: "" });
        }
      } catch (error) {
        if (!cancelled)
          setState({ step: "failed", message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
      void electron.cancelPersonalCloudPhoneSignIn().catch(() => undefined);
    };
  }, [active, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, retry };
}

/** The QR code as an <img> source. */
export const phoneSignInQrSource = (code: PersonalCloudDeviceCode) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code.qrSvg)}`;
