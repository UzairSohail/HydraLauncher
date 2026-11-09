import type { SettingsSyncError, SettingsSyncErrorReason } from "@types";

const MAX_DETAIL = 200;

/** Pulls the readable part out of a Google JSON error body, if there is one. */
const shorten = (message: string) => {
  const google = /"message"\s*:\s*"([^"]+)"/.exec(message);
  const text = google ? google[1] : message;
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL
    ? `${oneLine.slice(0, MAX_DETAIL - 1)}…`
    : oneLine;
};

const classify = (message: string): SettingsSyncErrorReason => {
  const text = message.toLowerCase();
  if (text.includes("has no sign-in details")) return "no_client";
  if (
    text.includes("not signed in yet") ||
    text.includes("no longer accepts this sign-in") ||
    text.includes("sign in again")
  ) {
    return "sign_in_expired";
  }
  if (/sign-in returned 4\d\d/.test(text)) return "sign_in_rejected";
  if (text.includes("google drive refused the request")) return "drive_refused";
  if (text.includes("can't reach google drive")) return "offline";
  return "unknown";
};

/**
 * Turns a failed sync into a reason the settings card can explain. Errors from
 * Cloud Save Manager arrive as anyhow chains joined with ": ".
 */
export const describeSettingsSyncError = (
  error: unknown
): SettingsSyncError => {
  const message = error instanceof Error ? error.message : String(error);
  // Only JSON.parse of the Drive file throws a SyntaxError in a sync.
  const reason = error instanceof SyntaxError ? "bad_file" : classify(message);
  return { reason, detail: shorten(message) };
};
