import type { AddUpdateSourceInput } from "@types";
import {
  addRecompilationUpdateSource,
  checkRecompilationUpdatesFor,
  getRecompilationUpdateState,
  getRecompilationUpdateSummaries,
  getUpdateProviders,
  installRecompilationFromSource,
  removeRecompilationUpdateSource,
  updateRecompilationUpdateSource,
} from "@main/services/game-updates";
import { rollbackRecompilation } from "@main/events/recompilation/recompilation-installer";
import { getRecompilationSnapshotsDirectory } from "@main/events/recompilation/recompilation-save-snapshots";
import { parseRecompilationRef } from "@main/events/recompilation/recompilation-paths";
import { shell } from "electron";
import fs from "node:fs";

import { registerEvent } from "../register-event";

registerEvent("getUpdateProviders", () => getUpdateProviders());

registerEvent("getRecompilationUpdateState", (_event, ref: unknown) =>
  getRecompilationUpdateState(ref)
);

registerEvent("getRecompilationUpdateSummaries", () =>
  getRecompilationUpdateSummaries()
);

registerEvent("checkRecompilationUpdates", (_event, ref: unknown) =>
  checkRecompilationUpdatesFor(ref)
);

registerEvent(
  "addRecompilationUpdateSource",
  (_event, ref: unknown, input: AddUpdateSourceInput) =>
    addRecompilationUpdateSource(ref, input)
);

registerEvent(
  "updateRecompilationUpdateSource",
  (
    _event,
    ref: unknown,
    sourceId: unknown,
    patch: { channel?: unknown; assetFilter?: unknown }
  ) => updateRecompilationUpdateSource(ref, sourceId, patch ?? {})
);

registerEvent(
  "removeRecompilationUpdateSource",
  (_event, ref: unknown, sourceId: unknown) =>
    removeRecompilationUpdateSource(ref, sourceId)
);

registerEvent(
  "installRecompilationFromSource",
  (_event, ref: unknown, sourceId: unknown) =>
    installRecompilationFromSource(ref, sourceId)
);

registerEvent("rollbackRecompilation", (_event, ref: unknown) =>
  rollbackRecompilation(ref)
);

registerEvent(
  "openRecompilationSaveSnapshots",
  async (_event, ref: unknown) => {
    const parsed = parseRecompilationRef(ref);
    if (!parsed) return false;
    const directory = getRecompilationSnapshotsDirectory(parsed.slug);
    await fs.promises.mkdir(directory, { recursive: true });
    return (await shell.openPath(directory)) === "";
  }
);
