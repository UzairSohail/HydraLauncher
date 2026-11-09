import { themesSublevel } from "@main/level";
import { SettingsSync } from "@main/services/settings-sync";
import { registerEvent } from "../register-event";
import {
  achievementNotificationPresenter,
  WindowManager,
} from "@main/services";

const updateCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  code: string
) => {
  const theme = await themesSublevel.get(themeId);

  if (!theme) {
    throw new Error("Theme not found");
  }

  await themesSublevel.put(themeId, {
    ...theme,
    code,
    updatedAt: new Date(),
  });

  if (theme.isActive) {
    WindowManager.mainWindow?.webContents.send("on-custom-theme-updated");
    achievementNotificationPresenter.notifyThemeUpdated();
  }

  SettingsSync.scheduleSync();
};

registerEvent("updateCustomTheme", updateCustomTheme);
