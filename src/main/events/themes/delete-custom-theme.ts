import { themesSublevel } from "@main/level";
import { SettingsSync } from "@main/services/settings-sync";
import { registerEvent } from "../register-event";

const deleteCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
) => {
  await themesSublevel.del(themeId);

  SettingsSync.scheduleSync();
};

registerEvent("deleteCustomTheme", deleteCustomTheme);
