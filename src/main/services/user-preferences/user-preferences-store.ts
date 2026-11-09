import { safeStorage } from "electron";

import type { UserPreferences } from "@types";
import { db, levelKeys } from "@main/level";
import { logger } from "../logger";
import {
  hasSecretFields,
  mergePreferenceSecrets,
  parsePreferenceSecrets,
  splitPreferenceSecrets,
  type PreferenceSecrets,
} from "./preference-secrets";

interface StoredPreferenceSecrets {
  /** JSON of PreferenceSecrets, base64 of the safeStorage ciphertext when encrypted. */
  data: string;
  encrypted: boolean;
}

const readPlainPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

export const readPreferenceSecrets = async (): Promise<PreferenceSecrets> => {
  const stored = await db
    .get<
      string,
      StoredPreferenceSecrets | null
    >(levelKeys.userPreferenceSecrets, { valueEncoding: "json" })
    .catch(() => null);

  if (!stored?.data) return {};

  try {
    const json = stored.encrypted
      ? safeStorage.decryptString(Buffer.from(stored.data, "base64"))
      : stored.data;
    return parsePreferenceSecrets(json);
  } catch (error) {
    logger.error("Failed to read stored API keys and tokens", error);
    return {};
  }
};

const writePreferenceSecrets = async (secrets: PreferenceSecrets) => {
  if (Object.keys(secrets).length === 0) {
    await db.del(levelKeys.userPreferenceSecrets).catch(() => undefined);
    return;
  }

  const json = JSON.stringify(secrets);
  const encrypted = safeStorage.isEncryptionAvailable();

  await db.put<string, StoredPreferenceSecrets>(
    levelKeys.userPreferenceSecrets,
    {
      data: encrypted
        ? safeStorage.encryptString(json).toString("base64")
        : json,
      encrypted,
    },
    { valueEncoding: "json" }
  );
};

/** User preferences including API keys and tokens. */
export const getUserPreferences = async () => {
  const [preferences, secrets] = await Promise.all([
    readPlainPreferences(),
    readPreferenceSecrets(),
  ]);
  return mergePreferenceSecrets(preferences, secrets);
};

/**
 * Saves the full preferences object. API keys and tokens are written to the
 * encrypted record and stripped from the plain one.
 */
export const saveUserPreferences = async (preferences: UserPreferences) => {
  const split = splitPreferenceSecrets(preferences);

  await writePreferenceSecrets(split.secrets);
  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    split.preferences,
    { valueEncoding: "json" }
  );
};

/** Moves API keys and tokens saved by older versions out of the plain record. */
export const migratePreferenceSecrets = async () => {
  const preferences = await readPlainPreferences();
  if (!hasSecretFields(preferences)) return;

  const merged = mergePreferenceSecrets(
    preferences,
    await readPreferenceSecrets()
  );
  if (merged) await saveUserPreferences(merged);

  logger.log("Moved API keys and tokens to encrypted storage");
};
