/** The catalogue API the launcher uses. Set at build time, with the launcher's default. */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL || "https://hydra-api-us-east-1.losbroxas.org"
).replace(/\/+$/, "");

/**
 * A "Web application" OAuth client in the same Google Cloud project as the
 * launcher's sign-in. Optional on Android, but Google recommends it.
 */
export const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || undefined;

/** Only files this Google Cloud project made, which is all the launcher's files. */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** The launcher's folder in Drive (Cloud Save Manager's). */
export const ROOT_FOLDER = "Cloud Save Manager";

/** How the phone signs its changes in the synced settings file. */
export const PHONE_DEVICE_ID = "phone";
