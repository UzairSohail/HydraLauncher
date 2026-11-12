import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  changedKeys,
  entryValues,
  mergeSyncEntries,
  recordCollection,
  recordLocalValues,
  type SyncEntries,
} from "./sync-merge.js";
import { generateSyncKey, openJson, sealJson } from "./secret-box.js";
import {
  emptySettingsSyncState,
  fromSettingsDocument,
  mergeSettingsState,
  pickSyncedPreferences,
  pickSyncedSecrets,
  toSettingsDocument,
} from "./settings-document.js";
import { describeSettingsSyncError } from "./sync-error.js";

describe("settings sync merge", () => {
  it("keeps the newer change per key, not per file", () => {
    const pc: SyncEntries<unknown> = {
      language: { value: "en", updatedAt: 10, deviceId: "pc" },
      autoplayGameTrailers: { value: false, updatedAt: 30, deviceId: "pc" },
    };
    const laptop: SyncEntries<unknown> = {
      language: { value: "pt", updatedAt: 20, deviceId: "laptop" },
      autoplayGameTrailers: { value: true, updatedAt: 5, deviceId: "laptop" },
    };

    const merged = entryValues(mergeSyncEntries(pc, laptop));
    assert.deepEqual(merged, { language: "pt", autoplayGameTrailers: false });
    assert.deepEqual(
      entryValues(mergeSyncEntries(laptop, pc)),
      merged,
      "merge order does not matter"
    );
  });

  it("breaks ties the same way on every device", () => {
    const a = { x: { value: 1, updatedAt: 5, deviceId: "a" } };
    const b = { x: { value: 2, updatedAt: 5, deviceId: "b" } };
    assert.deepEqual(entryValues(mergeSyncEntries(a, b)), { x: 2 });
    assert.deepEqual(entryValues(mergeSyncEntries(b, a)), { x: 2 });
  });

  it("lets the cloud win on a device that never synced", () => {
    const fresh = recordLocalValues({}, { language: "en" }, 1000, "ally");
    const cloud = { language: { value: "pt", updatedAt: 1, deviceId: "pc" } };
    assert.deepEqual(entryValues(mergeSyncEntries(fresh, cloud)), {
      language: "pt",
    });
  });

  it("stamps only values that actually changed", () => {
    const start = recordLocalValues({}, { a: 1, b: 2 }, 0, "pc");
    const next = recordLocalValues(start, { a: 1, b: 3 }, 50, "pc");
    assert.equal(next.a.updatedAt, 0);
    assert.equal(next.b.updatedAt, 50);
    assert.deepEqual(changedKeys(start, next), ["b"]);
  });

  it("keeps deletions so another device doesn't bring an item back", () => {
    const url = "https://example.com/source.json";
    const pc = recordCollection(
      recordCollection({}, { [url]: { name: "S", url } }, [], 1, "pc"),
      {},
      [url],
      100,
      "pc"
    );
    assert.equal(pc[url].deleted, true);

    const laptop = {
      [url]: { value: { name: "S", url }, updatedAt: 1, deviceId: "laptop" },
    };
    assert.deepEqual(entryValues(mergeSyncEntries(laptop, pc)), {});
  });

  it("doesn't treat an item that never arrived as deleted", () => {
    const url = "https://example.com/source.json";
    const fromCloud = {
      [url]: { value: { name: "S", url }, updatedAt: 1, deviceId: "laptop" },
    };
    const next = recordCollection(fromCloud, {}, [], 100, "pc");
    assert.equal(next[url].deleted, undefined);
  });

  it("re-adding after a deletion wins over the tombstone", () => {
    const deleted = recordLocalValues(
      recordLocalValues({}, { k: "v" }, 1, "pc"),
      { k: null },
      10,
      "pc"
    );
    const readded = recordLocalValues(deleted, { k: "v2" }, 20, "pc");
    assert.deepEqual(entryValues(readded), { k: "v2" });
  });
});

describe("settings sync secret box", () => {
  it("round-trips and rejects the wrong key or tampering", () => {
    const key = generateSyncKey();
    const box = sealJson(key, { realDebridApiToken: "secret" });

    assert.ok(!JSON.stringify(box).includes("secret"));
    assert.deepEqual(openJson(key, box), { realDebridApiToken: "secret" });
    assert.throws(() => openJson(generateSyncKey(), box));
    assert.throws(() =>
      openJson(key, { ...box, data: Buffer.from("x").toString("base64") })
    );
    assert.throws(() => sealJson(Buffer.alloc(16), {}));
  });
});

describe("settings sync document", () => {
  it("keeps device-only preferences and credentials out of the plain section", () => {
    const picked = pickSyncedPreferences({
      language: "en",
      downloadsPath: "C:/Games",
      launchInBigPicture: true,
      realDebridApiToken: "rd",
    });
    assert.equal(picked.language, "en");
    assert.ok(!("downloadsPath" in picked));
    assert.ok(!("launchInBigPicture" in picked));
    assert.ok(!("realDebridApiToken" in picked));

    assert.deepEqual(
      pickSyncedSecrets({ realDebridApiToken: "rd", torBoxApiToken: null }),
      { realDebridApiToken: "rd" }
    );
  });

  it("seals credentials in the Drive file and reads them back", () => {
    const key = generateSyncKey();
    const state = emptySettingsSyncState();
    state.secrets = recordLocalValues({}, { torBoxApiToken: "tb" }, 1, "pc");
    state.preferences = recordLocalValues({}, { language: "en" }, 1, "pc");

    const document = toSettingsDocument(state, key, 2, "pc");
    assert.ok(!JSON.stringify(document).includes('"tb"'));
    assert.deepEqual(fromSettingsDocument(document, key), state);
  });

  it("reports what came in and whether to push", () => {
    const local = emptySettingsSyncState();
    local.preferences = recordLocalValues({}, { language: "en" }, 5, "pc");

    assert.equal(mergeSettingsState(local, null).shouldPush, true);

    const remote = emptySettingsSyncState();
    remote.preferences = {
      language: { value: "pt", updatedAt: 9, deviceId: "laptop" },
    };
    remote.secrets = {
      torBoxApiToken: { value: "tb", updatedAt: 9, deviceId: "laptop" },
    };

    const result = mergeSettingsState(local, remote);
    assert.deepEqual(result.incoming.preferences, ["language"]);
    assert.deepEqual(result.incoming.secrets, ["torBoxApiToken"]);
    assert.equal(result.shouldPush, false);
  });
});

describe("settings sync collections", () => {
  it("brings in another device's collections and reads older documents", () => {
    const key = generateSyncKey();
    const remote = emptySettingsSyncState();
    remote.gameCollections = {
      rpg: {
        value: {
          name: "RPGs",
          createdAt: 1,
          ordered: true,
          games: ["steam:2", "steam:1"],
        },
        updatedAt: 5,
        deviceId: "laptop",
      },
    };

    const roundTripped = fromSettingsDocument(
      toSettingsDocument(remote, key, 5, "laptop"),
      key
    );
    const result = mergeSettingsState(emptySettingsSyncState(), roundTripped);
    assert.deepEqual(result.incoming.gameCollections, ["rpg"]);
    assert.deepEqual(result.merged.gameCollections.rpg.value?.games, [
      "steam:2",
      "steam:1",
    ]);

    const { gameCollections: _omitted, ...older } = toSettingsDocument(
      emptySettingsSyncState(),
      key,
      5,
      "laptop"
    );
    void _omitted;
    assert.deepEqual(fromSettingsDocument(older, key).gameCollections, {});
  });
});

describe("settings sync errors", () => {
  it("names a build without Google sign-in details", () => {
    const error = new Error(
      "this build has no sign-in details, so use --client with Google's .json file"
    );
    assert.equal(describeSettingsSyncError(error).reason, "no_client");
  });

  it("tells an expired sign-in from a rejected one", () => {
    assert.equal(
      describeSettingsSyncError(
        new Error(
          "sign in again with the auth command: Google no longer accepts this sign-in"
        )
      ).reason,
      "sign_in_expired"
    );
    assert.equal(
      describeSettingsSyncError(
        new Error("Google Drive refused the request: sign-in returned 401")
      ).reason,
      "sign_in_rejected"
    );
  });

  it("keeps only Google's own message from a Drive error body", () => {
    const error = new Error(
      'Google Drive refused the request: 403: {"error": {"code": 403, "message": "Google Drive API has not been used in project 123", "errors": []}}'
    );
    assert.deepEqual(describeSettingsSyncError(error), {
      reason: "drive_refused",
      detail: "Google Drive API has not been used in project 123",
    });
  });

  it("reports a damaged settings file", () => {
    let parseError: unknown;
    try {
      JSON.parse("{");
    } catch (error) {
      parseError = error;
    }
    assert.equal(describeSettingsSyncError(parseError).reason, "bad_file");
  });
});
