import { registerEvent } from "../register-event";
import { GameCollections } from "@main/services/game-collections";
import { SettingsSync } from "@main/services/settings-sync";

registerEvent("getGameCollections", () => GameCollections.list());

registerEvent(
  "createGameCollection",
  async (_event: Electron.IpcMainInvokeEvent, name: string) => {
    const collection = await GameCollections.create(name);
    SettingsSync.scheduleSync();
    return collection;
  }
);

registerEvent(
  "renameGameCollection",
  async (_event: Electron.IpcMainInvokeEvent, id: string, name: string) => {
    await GameCollections.rename(id, name);
    SettingsSync.scheduleSync();
  }
);

registerEvent(
  "deleteGameCollection",
  async (_event: Electron.IpcMainInvokeEvent, id: string) => {
    await GameCollections.remove(id);
    SettingsSync.scheduleSync();
  }
);
