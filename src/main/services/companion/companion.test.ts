import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseCompanionDeviceDocument,
  parseCompanionDocument,
  resolveAnyClaim,
} from "../../../shared/companion.js";
import { Downloader } from "../../../shared/constants.js";
import { pickCompanionDownload as pick } from "./pick-download.js";

/** The parts of @shared's getDownloadersForUri these tests need. */
const downloadersForUri = (uri: string) => {
  if (uri.startsWith("https://gofile.io")) return [Downloader.Gofile];
  if (uri.startsWith("magnet:")) {
    return [Downloader.TorBox, Downloader.RealDebrid, Downloader.AllDebrid];
  }
  return [Downloader.AllDebrid, Downloader.RealDebrid];
};

const pickCompanionDownload = (
  repack: Parameters<typeof pick>[0],
  tokens: Parameters<typeof pick>[1]
) => pick(repack, tokens, downloadersForUri);

const repack = {
  id: "r1",
  title: "Game v1.2",
  fileSize: "10 GB",
  uris: ["magnet:?xt=urn:btih:abc", "https://gofile.io/d/xyz"],
  uploadDate: null,
  downloadSourceId: "s1",
  downloadSourceName: "Source",
  createdAt: "",
};

describe("companion files", () => {
  it("keeps good requests and drops broken ones", () => {
    const document = parseCompanionDocument(
      JSON.stringify({
        version: 1,
        devices: ["pc", 3],
        requests: [
          {
            id: "a",
            createdAt: 1,
            target: "pc",
            shop: "steam",
            objectId: "1",
            title: "Game",
            repack,
          },
          { id: "b", target: "pc" },
          {
            id: "c",
            target: "any",
            shop: "steam",
            objectId: "2",
            title: "No links",
            repack: { ...repack, uris: [] },
          },
        ],
      })
    );
    assert.deepEqual(
      document.requests.map((request) => request.id),
      ["a"]
    );
    assert.deepEqual(document.devices, ["pc"]);
  });

  it("reads a device file with defaults", () => {
    const device = parseCompanionDeviceDocument(
      JSON.stringify({
        id: "pc",
        requests: { a: { state: "done", at: 5 }, b: { nope: true } },
      })
    );
    assert.equal(device.name, "pc");
    assert.equal(device.acceptsRequests, true);
    assert.deepEqual(Object.keys(device.requests), ["a"]);
  });

  it("gives an any request to the earliest claim", () => {
    const winner = resolveAnyClaim("a", [
      { id: "laptop", requests: { a: { state: "claimed", at: 20 } } },
      { id: "pc", requests: { a: { state: "claimed", at: 10 } } },
      { id: "ally", requests: { a: { state: "failed", at: 1 } } },
    ]);
    assert.equal(winner, "pc");
  });

  it("breaks a tie by device id and ignores skipped devices", () => {
    assert.equal(
      resolveAnyClaim("a", [
        { id: "b", requests: { a: { state: "claimed", at: 10 } } },
        { id: "a", requests: { a: { state: "claimed", at: 10 } } },
      ]),
      "a"
    );
    assert.equal(
      resolveAnyClaim("a", [
        { id: "b", requests: { a: { state: "skipped", at: 1 } } },
      ]),
      null
    );
  });
});

describe("picking a download for a phone request", () => {
  it("prefers AllDebrid when it's set up", () => {
    assert.deepEqual(
      pickCompanionDownload(repack, { allDebridApiToken: "key" }),
      { downloader: Downloader.AllDebrid, uri: repack.uris[0] }
    );
  });

  it("falls back to a direct download without debrid", () => {
    assert.deepEqual(pickCompanionDownload(repack, {}), {
      downloader: Downloader.Gofile,
      uri: repack.uris[1],
    });
  });

  it("never torrents without debrid", () => {
    assert.equal(pickCompanionDownload({ uris: [repack.uris[0]] }, null), null);
  });

  it("skips links marked unavailable", () => {
    assert.equal(
      pickCompanionDownload(
        { uris: [repack.uris[1]], unavailableUris: [repack.uris[1]] },
        {}
      ),
      null
    );
  });
});
