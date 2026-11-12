import { dialog } from "electron";

import { AchievementSync } from "@main/services/achievement-sync";
import { CompanionLink } from "@main/services/companion";
import { PersonalCloud } from "@main/services/personal-cloud";
import { SettingsSync } from "@main/services/settings-sync";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent("getPersonalCloudStatus", () => PersonalCloud.status());

registerEvent("signInPersonalCloud", async () => {
  const status = await PersonalCloud.signIn();
  if (status.signedIn) {
    void SettingsSync.syncNow();
    void AchievementSync.syncNow();
    void CompanionLink.checkNow();
  }
  return status;
});

registerEvent(
  "setPersonalCloudPaused",
  (_event: Electron.IpcMainInvokeEvent, paused: boolean) =>
    PersonalCloud.setPaused(paused)
);

registerEvent(
  "getPersonalCloudGameState",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    PersonalCloud.getGameState(shop, objectId)
);

registerEvent(
  "syncPersonalCloudGame",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    PersonalCloud.syncNow(shop, objectId)
);

registerEvent(
  "forcePersonalCloudUpload",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    PersonalCloud.forceUpload(shop, objectId)
);

registerEvent(
  "forcePersonalCloudDownload",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    PersonalCloud.forceDownload(shop, objectId)
);

registerEvent(
  "restorePersonalCloudVersion",
  (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    versionId: string
  ) => PersonalCloud.restoreVersion(shop, objectId, versionId)
);

registerEvent(
  "deletePersonalCloudVersion",
  (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    versionId: string
  ) => PersonalCloud.deleteVersion(shop, objectId, versionId)
);

registerEvent(
  "choosePersonalCloudSaveFolder",
  async (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string
  ) => {
    const window = WindowManager.mainWindow;
    const options: Electron.OpenDialogOptions = {
      properties: ["openDirectory"],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (canceled || !filePaths[0]) return null;
    return PersonalCloud.useSaveFolder(shop, objectId, filePaths[0]);
  }
);

registerEvent("getSettingsSyncStatus", () => SettingsSync.getStatus());

registerEvent(
  "setSettingsSyncEnabled",
  (_event: Electron.IpcMainInvokeEvent, enabled: boolean) =>
    SettingsSync.setEnabled(enabled)
);

registerEvent("syncSettingsNow", async () => {
  await SettingsSync.syncNow();
  return SettingsSync.getStatus();
});

registerEvent("getAchievementSyncStatus", () => AchievementSync.getStatus());

registerEvent("syncAchievementsNow", async () => {
  await AchievementSync.syncNow();
  return AchievementSync.getStatus();
});

registerEvent("getCompanionLinkStatus", () => CompanionLink.getStatus());

registerEvent(
  "setCompanionLinkEnabled",
  (_event: Electron.IpcMainInvokeEvent, enabled: boolean) =>
    CompanionLink.setEnabled(enabled)
);

registerEvent(
  "setCompanionDeviceName",
  (_event: Electron.IpcMainInvokeEvent, name: string) =>
    CompanionLink.setDeviceName(String(name ?? ""))
);
