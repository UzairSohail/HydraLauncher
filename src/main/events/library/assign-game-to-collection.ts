import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services";
import { GameCollections } from "@main/services/game-collections";
import { SettingsSync } from "@main/services/settings-sync";
import type { GameShop } from "@types";

const assignGameToCollection = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  collectionIds: string[]
) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

  if (!game) {
    throw new Error("game/not-found-local");
  }

  try {
    await GameCollections.assign(shop, objectId, collectionIds);
    SettingsSync.scheduleSync();
  } catch (error) {
    logger.error("Failed to assign game to collection", error);
    throw new Error(`Failed to assign game to collection: ${error}`);
  }
};

registerEvent("assignGameToCollection", assignGameToCollection);
