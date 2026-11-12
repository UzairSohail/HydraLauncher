import { registerEvent } from "../register-event";
import { UpdateManager } from "@main/services/update-manager";

const checkForUpdatesManually = async (_event: Electron.IpcMainInvokeEvent) => {
  return UpdateManager.checkForUpdatesManually();
};

registerEvent("checkForUpdatesManually", checkForUpdatesManually);
