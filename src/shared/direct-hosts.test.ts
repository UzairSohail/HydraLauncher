import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBuzzheavierUri, isMegaDbUri } from "./direct-hosts.js";

describe("direct hosts", () => {
  it("recognises Buzzheavier's short domains", () => {
    assert.equal(isBuzzheavierUri("https://bzzhr.to/gg0mx2lmdg8p"), true);
    assert.equal(isBuzzheavierUri("https://bzzhr.co/abc"), true);
    assert.equal(isBuzzheavierUri("https://www.buzzheavier.com/abc"), true);
    assert.equal(isBuzzheavierUri("https://notbzzhr.to/abc"), false);
  });

  it("recognises MegaDB file pages", () => {
    assert.equal(isMegaDbUri("https://megadb.net/6ngwrde03rzn"), true);
    assert.equal(isMegaDbUri("https://www.megadb.net/6ngwrde03rzn"), true);
    assert.equal(isMegaDbUri("https://notmegadb.net/abc"), false);
    assert.equal(isMegaDbUri("https://fs2.megadb.xyz/abc/x.rar"), false);
  });
});
