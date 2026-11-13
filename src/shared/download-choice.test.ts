import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Downloader } from "./constants.js";
import {
  pickDefaultDownloader,
  pickUriForDownloader,
} from "./download-choice.js";

const debrid = [Downloader.AllDebrid, Downloader.RealDebrid];

// A small stand-in for getDownloadersForUri in index.ts.
const getDownloadersForUri = (uri: string): Downloader[] => {
  if (uri.startsWith("https://gofile.io")) return [Downloader.Gofile];
  if (uri.startsWith("https://buzzheavier.com"))
    return [Downloader.Buzzheavier];
  if (uri.startsWith("magnet:")) return [...debrid, Downloader.TorBox];
  if (uri.startsWith("https://")) return [...debrid];
  return [];
};

const steamrip = {
  uris: [
    "https://megadb.net/abc",
    "https://buzzheavier.com/xyz",
    "https://gofile.io/d/123",
  ],
};

describe("download choice", () => {
  it("starts a direct listing on a host with its own downloader, not debrid", () => {
    const available = [
      Downloader.Gofile,
      Downloader.Buzzheavier,
      Downloader.AllDebrid,
    ];
    assert.equal(
      pickDefaultDownloader(steamrip, available, getDownloadersForUri),
      Downloader.Gofile
    );
  });

  it("still prefers AllDebrid for torrents", () => {
    const repack = {
      uris: ["magnet:?xt=urn:btih:abc", "https://gofile.io/d/1"],
    };
    assert.equal(
      pickDefaultDownloader(
        repack,
        [Downloader.Gofile, Downloader.TorBox, Downloader.AllDebrid],
        getDownloadersForUri
      ),
      Downloader.AllDebrid
    );
  });

  it("prefers AllDebrid on a host it is known to unlock", () => {
    const repack = {
      uris: ["https://gofile.io/d/1", "https://1fichier.com/?x"],
    };
    assert.equal(
      pickDefaultDownloader(
        repack,
        [Downloader.Gofile, Downloader.AllDebrid],
        getDownloadersForUri
      ),
      Downloader.AllDebrid
    );
  });

  it("hands debrid a known host before an unknown one", () => {
    const repack = {
      uris: ["https://megadb.net/abc", "https://1fichier.com/?x"],
    };
    assert.equal(
      pickUriForDownloader(repack, Downloader.AllDebrid, getDownloadersForUri),
      "https://1fichier.com/?x"
    );
  });

  it("skips links marked unavailable when another exists", () => {
    const repack = {
      uris: ["https://1fichier.com/?x", "https://megadb.net/abc"],
      unavailableUris: ["https://1fichier.com/?x"],
    };
    assert.equal(
      pickUriForDownloader(repack, Downloader.AllDebrid, getDownloadersForUri),
      "https://megadb.net/abc"
    );
  });

  it("falls back to debrid when it is the only option", () => {
    assert.equal(
      pickDefaultDownloader(
        { uris: ["https://megadb.net/abc"] },
        [Downloader.RealDebrid, Downloader.AllDebrid],
        getDownloadersForUri
      ),
      Downloader.AllDebrid
    );
  });
});
