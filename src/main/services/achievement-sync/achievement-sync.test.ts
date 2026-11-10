import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fromSyncedGame,
  mergeSyncedAchievements,
  parseAchievementDocument,
  toAchievementDocument,
  toSyncedGame,
  withSyncedUnlocks,
} from "./achievement-document.js";
import { SyncedUnlocksStore } from "./synced-unlocks-store.js";

describe("achievement sync merge", () => {
  it("unions unlocks from both devices and keeps the earliest time", () => {
    const pc = {
      "steam:1": {
        A: { unlockTime: 300 },
        B: { unlockTime: 100 },
      },
    };
    const laptop = {
      "steam:1": {
        A: { unlockTime: 200 },
        C: { unlockTime: 400 },
      },
      "steam:2": { X: { unlockTime: 50 } },
    };

    const { merged, changedGames } = mergeSyncedAchievements(pc, laptop);

    assert.deepEqual(merged, {
      "steam:1": {
        A: { unlockTime: 200 },
        B: { unlockTime: 100 },
        C: { unlockTime: 400 },
      },
      "steam:2": { X: { unlockTime: 50 } },
    });
    assert.deepEqual(changedGames.sort(), ["steam:1", "steam:2"]);
  });

  it("reports no change when the other side adds nothing", () => {
    const local = { "steam:1": { A: { unlockTime: 100 } } };
    const remote = { "steam:1": { A: { unlockTime: 200 } } };
    assert.deepEqual(mergeSyncedAchievements(local, remote).changedGames, []);
    assert.deepEqual(mergeSyncedAchievements(remote, local).changedGames, [
      "steam:1",
    ]);
  });

  it("keeps the earliest hardcore time and ignores zero times", () => {
    const { merged } = mergeSyncedAchievements(
      { "steam:1": { A: { unlockTime: 0, hardcoreUnlockTime: 90 } } },
      { "steam:1": { A: { unlockTime: 100, hardcoreUnlockTime: 80 } } }
    );
    assert.deepEqual(merged["steam:1"].A, {
      unlockTime: 100,
      hardcoreUnlockTime: 80,
    });
  });

  it("converts unlock lists by upper-case name and drops locked entries", () => {
    const game = toSyncedGame([
      { name: "first", unlockTime: 500 },
      { name: "FIRST", unlockTime: 300 },
      { name: "locked", unlockTime: 0 },
    ]);
    assert.deepEqual(game, { FIRST: { unlockTime: 300 } });
    assert.deepEqual(fromSyncedGame(game), [
      { name: "FIRST", unlockTime: 300, hardcoreUnlockTime: null },
    ]);
  });

  it("adds synced unlocks to a local list without losing local data", () => {
    const result = withSyncedUnlocks(
      [{ name: "a", unlockTime: 500, imageKey: "key" }],
      { A: { unlockTime: 100 }, B: { unlockTime: 200 } }
    );
    assert.deepEqual(result, [
      {
        name: "a",
        unlockTime: 100,
        imageKey: "key",
        hardcoreUnlockTime: null,
      },
      { name: "B", unlockTime: 200, hardcoreUnlockTime: null },
    ]);
  });

  it("round-trips the Drive document and skips malformed entries", () => {
    const document = toAchievementDocument(
      { "steam:1": { A: { unlockTime: 100 } } },
      1,
      "pc"
    );
    const raw = JSON.stringify({
      ...document,
      games: {
        ...document.games,
        "steam:2": { b: { unlockTime: "nope" }, c: { unlockTime: 5 } },
        "steam:3": null,
      },
    });
    assert.deepEqual(parseAchievementDocument(raw), {
      "steam:1": { A: { unlockTime: 100 } },
      "steam:2": { C: { unlockTime: 5 } },
    });
  });

  it("leaves Epic and custom games alone", () => {
    SyncedUnlocksStore.replace({ "epic:1": { A: { unlockTime: 1 } } });
    assert.deepEqual(SyncedUnlocksStore.withSynced("epic", "1", []), []);
    SyncedUnlocksStore.replace({});
  });
});
