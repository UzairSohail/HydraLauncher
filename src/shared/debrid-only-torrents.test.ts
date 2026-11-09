import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DownloadError, Downloader } from "./constants.js";
import { isBlockedTorrentDownload } from "./debrid-only.js";
import { isDebridPendingError } from "../main/services/download/debrid-files.js";

const magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";

describe("debrid-only torrents", () => {
  it("blocks starting a magnet with the torrent downloader", () => {
    assert.equal(isBlockedTorrentDownload(Downloader.Torrent, magnet), true);
    assert.equal(isBlockedTorrentDownload(Downloader.TorBox, magnet), false);
    assert.equal(
      isBlockedTorrentDownload(Downloader.Gofile, "https://gofile.io/d/x"),
      false
    );
  });

  it("treats uncached Premiumize and AllDebrid magnets as pending", () => {
    assert.equal(
      isDebridPendingError(
        new Error(DownloadError.PremiumizeTransferStarted),
        Downloader.Premiumize
      ),
      true
    );
    assert.equal(
      isDebridPendingError(
        new Error(DownloadError.AllDebridTorrentNotReady),
        Downloader.AllDebrid
      ),
      true
    );
    assert.equal(
      isDebridPendingError(
        new Error(DownloadError.NotCachedOnAllDebrid),
        Downloader.AllDebrid
      ),
      false
    );
  });
});
