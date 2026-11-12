import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UpdateRelease, UpdateSourceConfig } from "@types";
import type { UpdateProvider } from "./update-provider.js";
import {
  buildSourceState,
  CHECK_INTERVAL_MS,
  emptyStatus,
  isCheckDue,
  pickBestSource,
  recordCheckFailure,
  recordCheckSuccess,
  type InstalledPort,
} from "./update-state.js";

const release = (version: string, assets: string[] = []): UpdateRelease => ({
  version,
  tag: version,
  name: null,
  publishedAt: null,
  pageUrl: `https://example.com/${version}`,
  notesMarkdown: null,
  isPrerelease: false,
  assets: assets.map((name) => ({
    name,
    url: `https://example.com/${name}`,
    size: null,
    sha256: null,
  })),
});

const provider = (supportsDownloads = true): UpdateProvider => ({
  id: "test",
  displayName: "Test",
  inputExample: "",
  supportsChannels: true,
  supportsDownloads,
  parseInput: (input) => input,
  getSourceUrl: () => null,
  fetchLatest: async () => null,
});

const config = (id: string): UpdateSourceConfig => ({
  id,
  providerId: "test",
  locator: id,
  channel: "stable",
  assetFilter: null,
  addedAt: "2026-01-01T00:00:00Z",
});

const installed: InstalledPort = {
  version: "1.0.0",
  installedAt: "2026-10-01T00:00:00Z",
  sourceId: "catalog",
  assetName: "port-1.0.0-windows.zip",
};

const stateFor = (
  id: string,
  latest: UpdateRelease | null,
  sourceProvider: UpdateProvider | null = provider()
) =>
  buildSourceState(
    config(id),
    recordCheckSuccess(emptyStatus(), latest, 0),
    sourceProvider,
    installed,
    "win32",
    "x64"
  );

describe("check scheduling", () => {
  it("is due on first run, then daily, and backs off after failures", () => {
    const fresh = emptyStatus();
    assert.equal(isCheckDue(fresh, 0), true);

    const checked = recordCheckSuccess(fresh, null, 1_000);
    assert.equal(isCheckDue(checked, 1_000 + CHECK_INTERVAL_MS - 1), false);
    assert.equal(isCheckDue(checked, 1_000 + CHECK_INTERVAL_MS), true);

    const failedOnce = recordCheckFailure(checked, "network_error", 5_000);
    const failedTwice = recordCheckFailure(failedOnce, "network_error", 5_000);
    assert.equal(failedOnce.retryAt, 5_000 + 60 * 60 * 1000);
    assert.equal(failedTwice.retryAt, 5_000 + 2 * 60 * 60 * 1000);
    assert.equal(isCheckDue(failedTwice, 5_000), false);
  });
});

describe("source state", () => {
  it("finds the install file and flags newer releases", () => {
    const state = stateFor(
      "fork",
      release("1.1.0", ["port-1.1.0-windows.zip"])
    );
    assert.equal(state.hasUpdate, true);
    assert.equal(state.installAsset?.name, "port-1.1.0-windows.zip");
  });

  it("keeps sources whose provider was unregistered, without results", () => {
    const state = stateFor("gone", release("9.0.0", ["x-windows.zip"]), null);
    assert.equal(state.isProviderAvailable, false);
    assert.equal(state.hasUpdate, false);
  });

  it("has no install file for version-only providers", () => {
    const state = stateFor("itch", release("2.0.0"), provider(false));
    assert.equal(state.hasUpdate, true);
    assert.equal(state.installAsset, null);
  });
});

describe("pickBestSource", () => {
  it("prefers the installed source when it has an update", () => {
    const catalog = stateFor("catalog", release("1.1.0", ["port-windows.zip"]));
    const fork = stateFor("fork", release("1.4.0", ["port-windows.zip"]));
    assert.equal(pickBestSource([fork, catalog], "catalog")?.id, "catalog");
  });

  it("otherwise picks the newest downloadable update", () => {
    const manual = stateFor("itch", release("3.0.0"), provider(false));
    const older = stateFor("a", release("1.2.0", ["port-windows.zip"]));
    const newer = stateFor("b", release("1.3.0", ["port-windows.zip"]));
    assert.equal(pickBestSource([manual, older, newer], "catalog")?.id, "b");
  });

  it("falls back to a manual update and returns null when up to date", () => {
    const manual = stateFor("itch", release("3.0.0"), provider(false));
    const current = stateFor("catalog", release("1.0.0", ["port-windows.zip"]));
    assert.equal(pickBestSource([manual, current], "catalog")?.id, "itch");
    assert.equal(pickBestSource([current], "catalog"), null);
  });
});
