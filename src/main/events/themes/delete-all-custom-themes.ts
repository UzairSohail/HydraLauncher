import { themesSublevel } from "@main/level";
import { SettingsSync } from "@main/services/settings-sync";
import { registerEvent } from "../register-event";

const deleteAllCustomThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  await themesSublevel.clear();

  SettingsSync.scheduleSync();
};

registerEvent("deleteAllCustomThemes", deleteAllCustomThemes);
