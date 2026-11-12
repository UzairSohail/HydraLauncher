import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareVersions,
  extractVersion,
  findGameUpdate,
  findRepackByUri,
  type InstalledRepackInfo,
  type RepackLike,
} from "./game-updates.js";

const repack = (overrides: Partial<RepackLike>): RepackLike => ({
  id: "r1",
  title: "Some Game v1.0.0",
  fileSize: "10 GB",
  uris: [`https://example.com/${overrides.id ?? "r1"}`],
  uploadDate: "2026-01-01T00:00:00.000Z",
  downloadSourceId: "src00001",
  downloadSourceName: "FitGirl",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const installed: InstalledRepackInfo = {
  id: "r1",
  title: "Some Game v1.0.0 + 2 DLCs",
  downloadSourceId: "src00001",
  downloadSourceName: "FitGirl",
  uploadDate: "2026-01-01T00:00:00.000Z",
  uri: "https://example.com/r1",
};

describe("game updates", () => {
  it("reads versions from release titles", () => {
    assert.deepEqual(extractVersion("Game – v2.21 + DLC"), [2, 21]);
    assert.deepEqual(extractVersion("Game (Build 14523)"), [14523]);
    assert.deepEqual(extractVersion("Game 1.2.3.4 [SteamRIP]"), [1, 2, 3, 4]);
    assert.deepEqual(extractVersion("Game v1_05"), [1, 5]);
    assert.equal(extractVersion("Cyberpunk 2077"), null);
    assert.equal(extractVersion("V Rising"), null);
    assert.equal(compareVersions([1, 10], [1, 9, 9]), 1);
    assert.equal(compareVersions([1, 0], [1]), 0);
  });

  it("finds a newer version from the same source", () => {
    const update = repack({ id: "r2", title: "Some Game v1.1.0 + 3 DLCs" });
    const result = findGameUpdate(installed, [
      repack({ id: "r1", title: installed.title }),
      update,
      repack({ id: "r3", title: "Some Game v2.0.0", downloadSourceId: "x" }),
    ]);
    assert.equal(result?.id, "r2");
  });

  it("ignores older versions, re-listings and other games", () => {
    assert.equal(
      findGameUpdate(installed, [
        repack({ id: "r2", title: "Some Game v0.9.0" }),
        repack({ id: "r3", title: installed.title }),
        repack({ id: "r4", title: "Some Game v1.0.0 + 2 DLCs [fixed]" }),
        repack({ id: "r5", title: "Some Game v1.5", uris: [installed.uri!] }),
        repack({ id: "r6", title: "Another Thing v9.0" }),
      ]),
      null
    );
  });

  it("falls back to the upload date when titles carry no version", () => {
    const plain = { ...installed, title: "Some Game", uri: null };
    const newer = repack({
      id: "r2",
      title: "Some Game (Update 3)",
      uploadDate: "2026-02-01T00:00:00.000Z",
    });
    const older = repack({
      id: "r3",
      title: "Some Game (old)",
      uploadDate: "2025-12-01T00:00:00.000Z",
    });
    assert.equal(findGameUpdate(plain, [older, newer])?.id, "r2");
  });

  it("picks the highest version when several are newer", () => {
    const result = findGameUpdate(installed, [
      repack({ id: "r2", title: "Some Game v1.2" }),
      repack({ id: "r3", title: "Some Game v1.10" }),
      repack({ id: "r4", title: "Some Game v1.3" }),
    ]);
    assert.equal(result?.id, "r3");
  });

  it("finds the installed listing by its link", () => {
    const listing = repack({
      id: "r9",
      uris: [],
      uriGroups: [["https://example.com/a", "https://example.com/b"]],
    });
    assert.equal(
      findRepackByUri([repack({}), listing], "https://example.com/a")?.id,
      "r9"
    );
  });
});
