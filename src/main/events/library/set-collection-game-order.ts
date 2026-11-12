import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import { GameCollections } from "@main/services/game-collections";
import { SettingsSync } from "@main/services/settings-sync";
import type { GameShop } from "@types";

const setCollectionGameOrder = async (
  _event: Electron.IpcMainInvokeEvent,
  collectionId: string,
  games: { shop: GameShop; objectId: string }[]
) => {
  try {
    await GameCollections.setOrder(collectionId, games);
    SettingsSync.scheduleSync();
  } catch (error) {
    logger.error("Failed to set collection game order", error);
    throw new Error(`Failed to set collection game order: ${error}`);
  }
};

registerEvent("setCollectionGameOrder", setCollectionGameOrder);
