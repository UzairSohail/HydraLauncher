import { Theme } from "@types";
import { SettingsSync } from "@main/services/settings-sync";
import { registerEvent } from "../register-event";
import { themesSublevel } from "@main/level";

const addCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  theme: Theme
) => {
  await themesSublevel.put(theme.id, theme);

  SettingsSync.scheduleSync();
};

registerEvent("addCustomTheme", addCustomTheme);
