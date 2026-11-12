import { GameUpdates } from "@main/services/game-updates";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

registerEvent("checkGameUpdates", () => GameUpdates.checkAll());

registerEvent(
  "skipGameUpdate",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    GameUpdates.skipUpdate(shop, objectId)
);
