import type { LocalGameCollection } from "@types";
import { db } from "../level";
import { levelKeys } from "./keys";

export const gameCollectionsSublevel = db.sublevel<string, LocalGameCollection>(
  levelKeys.gameCollections,
  { valueEncoding: "json" }
);
