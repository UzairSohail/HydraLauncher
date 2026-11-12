import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UpdateAsset, UpdateRelease } from "@types";
import { assetNameShape, selectReleaseAsset } from "./asset-selection.js";
import { compareVersions, isNewerRelease } from "./version-compare.js";

const asset = (name: string): UpdateAsset => ({
  name,
  url: `https://example.com/${name}`,
  size: null,
  sha256: null,
});

const pick = (
  names: string[],
  options: Partial<Parameters<typeof selectReleaseAsset>[1]> = {}
) =>
  selectReleaseAsset(names.map(asset), {
    platform: "win32",
    arch: "x64",
    ...options,
  })?.name ?? null;

describe("selectReleaseAsset", () => {
  const release = [
    "Port-1.2.0-linux-x64.AppImage",
    "Port-1.2.0-macos.zip",
    "Port-1.2.0-windows-arm64.zip",
    "Port-1.2.0-windows-x64.zip",
    "Port-1.2.0-windows-x64.zip.sha256",
    "Source code.zip",
  ];

  it("picks the file for this OS and architecture", () => {
    assert.equal(pick(release), "Port-1.2.0-windows-x64.zip");
    assert.equal(
      pick(release, { arch: "arm64" }),
      "Port-1.2.0-windows-arm64.zip"
    );
    assert.equal(
      pick(release, { platform: "linux" }),
      "Port-1.2.0-linux-x64.AppImage"
    );
  });

  it("prefers the naming of the installed file", () => {
    assert.equal(
      pick(["port-win-portable.zip", "port-win-installer.zip"], {
        previousAssetName: "port-win-installer.zip",
      }),
      "port-win-installer.zip"
    );
  });

  it("honours substring and regex filters", () => {
    assert.equal(
      pick(release, { filter: "arm64" }),
      "Port-1.2.0-windows-arm64.zip"
    );
    assert.equal(
      pick(release, { filter: "/macos\\.zip$/" }),
      "Port-1.2.0-macos.zip"
    );
    assert.equal(pick(release, { filter: "nothing-matches" }), null);
  });

  it("returns null when only other platforms are published", () => {
    assert.equal(pick(["port-linux.tar.gz", "port-macos.dmg"]), null);
  });

  it("ignores version numbers when comparing names", () => {
    assert.equal(
      assetNameShape("Port-v1.2.0-win.zip"),
      assetNameShape("Port-v1.10.3-rc2-win.zip")
    );
  });
});

const release = (
  version: string,
  publishedAt: string | null = null
): UpdateRelease => ({
  version,
  tag: version,
  name: null,
  publishedAt,
  pageUrl: null,
  notesMarkdown: null,
  isPrerelease: false,
  assets: [],
});

describe("version comparison", () => {
  it("orders dotted versions and pre-release suffixes", () => {
    assert.equal(compareVersions("v1.10.0", "1.9.9"), 1);
    assert.equal(compareVersions("1.2", "1.2.0"), 0);
    assert.equal(compareVersions("1.2.0-rc1", "1.2.0"), -1);
    assert.equal(compareVersions("nightly", "1.0"), null);
  });

  it("detects newer releases", () => {
    const installed = {
      version: "1.2.0",
      installedAt: "2026-10-01T00:00:00Z",
      sourceId: "a",
    };

    assert.equal(isNewerRelease(release("1.3.0"), "b", installed), true);
    assert.equal(isNewerRelease(release("1.1.0"), "b", installed), false);
    assert.equal(isNewerRelease(release("v1.2.0"), "b", installed), false);
  });

  it("treats a republished rolling tag from the installed source as new", () => {
    const installed = {
      version: "nightly",
      installedAt: "2026-10-01T00:00:00Z",
      sourceId: "a",
    };
    const republished = release("nightly", "2026-11-01T00:00:00Z");

    assert.equal(isNewerRelease(republished, "a", installed), true);
    assert.equal(isNewerRelease(republished, "b", installed), false);
    assert.equal(
      isNewerRelease(
        release("nightly", "2026-09-01T00:00:00Z"),
        "a",
        installed
      ),
      false
    );
  });

  it("falls back to dates for versions that can't be compared", () => {
    const installed = {
      version: "build-a",
      installedAt: "2026-10-01T00:00:00Z",
      sourceId: "a",
    };
    assert.equal(
      isNewerRelease(
        release("build-b", "2026-09-01T00:00:00Z"),
        "a",
        installed
      ),
      false
    );
    assert.equal(
      isNewerRelease(
        release("build-b", "2026-11-01T00:00:00Z"),
        "a",
        installed
      ),
      true
    );
  });
});
