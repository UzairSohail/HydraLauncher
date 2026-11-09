import { getUserPreferences } from "../user-preferences";
import { HydraApi } from "../hydra-api";
import { resolveEmulatorAchievementTracking } from "./emulator-achievement-tracking";

export const loadEmulatorAchievementTracking = async () => {
  const userPreferences = await getUserPreferences().catch(() => null);

  return resolveEmulatorAchievementTracking(
    userPreferences,
    HydraApi.hasActiveSubscription(),
    process.platform
  );
};
