import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBuzzheavierUri, isFileDitchUri } from "./direct-hosts.js";

describe("direct hosts", () => {
  it("recognises Buzzheavier's short domains", () => {
    assert.equal(isBuzzheavierUri("https://bzzhr.to/gg0mx2lmdg8p"), true);
    assert.equal(isBuzzheavierUri("https://bzzhr.co/abc"), true);
    assert.equal(isBuzzheavierUri("https://www.buzzheavier.com/abc"), true);
    assert.equal(isBuzzheavierUri("https://notbzzhr.to/abc"), false);
  });

  it("recognises FileDitch file links", () => {
    assert.equal(
      isFileDitchUri(
        "https://itsfileditchfiles.st/alpha42/27a4324cacfe3df84b4f/DREADMOOR-SteamRIP.com.rar"
      ),
      true
    );
    assert.equal(isFileDitchUri("https://fileditchfiles.me/x/y.rar"), true);
    assert.equal(isFileDitchUri("https://gofile.io/d/x"), false);
    assert.equal(isFileDitchUri("magnet:?xt=urn:btih:abc"), false);
  });
});
