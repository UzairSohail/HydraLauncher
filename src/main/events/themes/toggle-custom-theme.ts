import { themesSublevel } from "@main/level";
import { SettingsSync } from "@main/services/settings-sync";
import { registerEvent } from "../register-event";
import { achievementNotificationPresenter } from "@main/services";

const toggleCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  isActive: boolean
) => {
  const theme = await themesSublevel.get(themeId);

  if (!theme) {
    throw new Error("Theme not found");
  }

  await themesSublevel.put(themeId, {
    ...theme,
    isActive,
    updatedAt: new Date(),
  });

  achievementNotificationPresenter.notifyThemeUpdated();

  SettingsSync.scheduleSync();
};

registerEvent("toggleCustomTheme", toggleCustomTheme);
