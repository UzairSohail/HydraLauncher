import type { UserPreferences } from "@types";

/**
 * Preferences that hold credentials. They are never written to the plain
 * `userPreferences` record; they live in an OS-encrypted record instead.
 */
export const SECRET_PREFERENCE_KEYS = [
  "realDebridApiToken",
  "premiumizeApiToken",
  "allDebridApiToken",
  "torBoxApiToken",
  "ggDealsApiKey",
  "retroAchievementsWebApiKey",
] as const satisfies readonly (keyof UserPreferences)[];

export type SecretPreferenceKey = (typeof SECRET_PREFERENCE_KEYS)[number];

export type PreferenceSecrets = Partial<Record<SecretPreferenceKey, string>>;

const isSecretValue = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export const hasSecretFields = (
  preferences: Partial<UserPreferences> | null | undefined
) =>
  !!preferences &&
  SECRET_PREFERENCE_KEYS.some((key) => Object.hasOwn(preferences, key));

/** Separates credentials from the rest of the preferences. */
export const splitPreferenceSecrets = (
  preferences: UserPreferences
): { preferences: UserPreferences; secrets: PreferenceSecrets } => {
  const publicPreferences: UserPreferences = { ...preferences };
  const secrets: PreferenceSecrets = {};

  for (const key of SECRET_PREFERENCE_KEYS) {
    const value = preferences[key];
    if (isSecretValue(value)) secrets[key] = value;
    delete publicPreferences[key];
  }

  return { preferences: publicPreferences, secrets };
};

/**
 * Puts credentials back on the preferences. A credential still present in the
 * plain record (written before migration) is used only when no encrypted one
 * exists.
 */
export const mergePreferenceSecrets = (
  preferences: UserPreferences | null,
  secrets: PreferenceSecrets
): UserPreferences | null => {
  const hasSecrets = Object.keys(secrets).length > 0;
  if (!preferences && !hasSecrets) return preferences;

  const merged: UserPreferences = { ...preferences };
  for (const key of SECRET_PREFERENCE_KEYS) {
    const value = secrets[key];
    if (isSecretValue(value)) merged[key] = value;
  }

  return merged;
};

export const parsePreferenceSecrets = (raw: string): PreferenceSecrets => {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") return {};

  const secrets: PreferenceSecrets = {};
  for (const key of SECRET_PREFERENCE_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (isSecretValue(value)) secrets[key] = value;
  }
  return secrets;
};
