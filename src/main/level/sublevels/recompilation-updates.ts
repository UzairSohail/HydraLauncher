import type { UpdateSourceConfig, UpdateSourceStatus } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export interface RecompilationUpdateRecord {
  objectId: string;
  slug: string;
  sources: UpdateSourceConfig[];
  /** Keyed by source id, including the implicit catalog source. */
  statuses: Record<string, UpdateSourceStatus>;
}

export const recompilationUpdatesSublevel = db.sublevel<
  string,
  RecompilationUpdateRecord
>(levelKeys.recompilationUpdates, {
  valueEncoding: "json",
});
