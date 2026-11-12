import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from "@react-native-google-signin/google-signin";

import { DRIVE_SCOPE, GOOGLE_WEB_CLIENT_ID } from "./config";

export interface GoogleAccount {
  email: string;
  name: string | null;
}

let configured = false;

const configure = () => {
  if (configured) return;
  GoogleSignin.configure({
    scopes: [DRIVE_SCOPE],
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });
  configured = true;
};

const toAccount = (user: { email: string; name: string | null }) => ({
  email: user.email,
  name: user.name,
});

/** The account signed in last time, without showing anything. */
export const restoreSignIn = async (): Promise<GoogleAccount | null> => {
  configure();
  try {
    const result = await GoogleSignin.signInSilently();
    return result.type === "success" ? toAccount(result.data.user) : null;
  } catch {
    return null;
  }
};

export const signIn = async (): Promise<GoogleAccount | null> => {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await GoogleSignin.signIn();
  if (result.type !== "success") return null;
  if (!result.data.scopes.includes(DRIVE_SCOPE)) {
    const added = await GoogleSignin.addScopes({ scopes: [DRIVE_SCOPE] });
    if (added?.type !== "success") {
      throw new Error("Nacho needs access to its Google Drive files to work.");
    }
  }
  return toAccount(result.data.user);
};

export const signOut = async () => {
  configure();
  cachedToken = null;
  await GoogleSignin.signOut();
};

/** Google tokens last an hour; reuse one for a bit less than that. */
const TOKEN_LIFETIME_MS = 45 * 60_000;
let cachedToken: { value: string; at: number } | null = null;
let pendingToken: Promise<string> | null = null;

/**
 * The Drive access token. The sign-in library allows only one getTokens call
 * at a time, so parallel Drive requests share one call and its result.
 */
export const getAccessToken = (): Promise<string> => {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_LIFETIME_MS) {
    return Promise.resolve(cachedToken.value);
  }
  pendingToken ??= (async () => {
    configure();
    try {
      const { accessToken } = await GoogleSignin.getTokens();
      cachedToken = { value: accessToken, at: Date.now() };
      return accessToken;
    } finally {
      pendingToken = null;
    }
  })();
  return pendingToken;
};

/** Drops a token Google refused, so the next call gets a fresh one. */
export const forgetAccessToken = async (token: string) => {
  if (cachedToken?.value === token) cachedToken = null;
  await GoogleSignin.clearCachedAccessToken(token).catch(() => null);
};

export const describeSignInError = (error: unknown) => {
  if (isErrorWithCode(error)) {
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      return "Google Play services isn't available on this phone.";
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return "Sign-in is already in progress.";
    }
    // DEVELOPER_ERROR: the app's signing key or package isn't registered.
    if (error.code === "10" || error.code === "DEVELOPER_ERROR") {
      return "Google doesn't recognise this app yet. Add the Android sign-in client from the setup guide to the launcher's Google Cloud project.";
    }
  }
  return error instanceof Error ? error.message : String(error);
};
