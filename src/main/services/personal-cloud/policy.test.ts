import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getPersonalCloudLinkInput } from "./policy.js";

const game = {
  objectId: "123",
  title: "Starfall Saga",
  executablePath: "C:\\Games\\Starfall\\Starfall.exe",
};

describe("getPersonalCloudLinkInput", () => {
  it("links Windows games without a prefix", () => {
    assert.deepEqual(
      getPersonalCloudLinkInput(game, {
        platform: "win32",
        winePrefixPath: "/ignored",
      }),
      {
        exePath: game.executablePath,
        name: "Starfall Saga",
      }
    );
  });

  it("links Linux games run through Wine with Hydra's prefix", () => {
    const input = getPersonalCloudLinkInput(
      { ...game, executablePath: "/games/starfall/Starfall.EXE" },
      { platform: "linux", winePrefixPath: "/prefixes/123" }
    );
    assert.equal(input?.winePrefixPath, "/prefixes/123");
  });

  it("skips native Linux games, macOS and games without an executable", () => {
    const linuxNative = { ...game, executablePath: "/games/starfall/run.sh" };
    assert.equal(
      getPersonalCloudLinkInput(linuxNative, {
        platform: "linux",
        winePrefixPath: "/prefixes/123",
      }),
      null
    );
    assert.equal(
      getPersonalCloudLinkInput(game, {
        platform: "darwin",
        winePrefixPath: null,
      }),
      null
    );
    assert.equal(
      getPersonalCloudLinkInput(
        { ...game, executablePath: null },
        { platform: "win32", winePrefixPath: null }
      ),
      null
    );
  });

  it("skips emulator ROMs and shortcuts on Windows", () => {
    for (const executablePath of [
      "C:\\Roms\\game.iso",
      "C:\\Games\\start.lnk",
    ]) {
      assert.equal(
        getPersonalCloudLinkInput(
          { ...game, executablePath },
          { platform: "win32", winePrefixPath: null }
        ),
        null
      );
    }
  });

  it("falls back to the object id when the game has no title", () => {
    assert.equal(
      getPersonalCloudLinkInput(
        { ...game, title: "  " },
        { platform: "win32", winePrefixPath: null }
      )?.name,
      "123"
    );
  });
});
