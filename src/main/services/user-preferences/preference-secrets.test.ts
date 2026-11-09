import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasSecretFields,
  mergePreferenceSecrets,
  parsePreferenceSecrets,
  splitPreferenceSecrets,
} from "./preference-secrets.js";

describe("preference secrets", () => {
  it("strips every credential from the plain preferences", () => {
    const { preferences, secrets } = splitPreferenceSecrets({
      language: "en",
      realDebridApiToken: "rd",
      torBoxApiToken: "tb",
      premiumizeApiToken: null,
      allDebridApiToken: "",
      ggDealsApiKey: "gg",
      retroAchievementsWebApiKey: "ra",
      retroAchievementsUsername: "nacho",
    });

    assert.deepEqual(preferences, {
      language: "en",
      retroAchievementsUsername: "nacho",
    });
    assert.deepEqual(secrets, {
      realDebridApiToken: "rd",
      torBoxApiToken: "tb",
      ggDealsApiKey: "gg",
      retroAchievementsWebApiKey: "ra",
    });
    assert.equal(hasSecretFields(preferences), false);
  });

  it("round-trips through split and merge", () => {
    const original = { language: "pt", realDebridApiToken: "rd" };
    const { preferences, secrets } = splitPreferenceSecrets(original);
    assert.deepEqual(mergePreferenceSecrets(preferences, secrets), original);
  });

  it("prefers the encrypted credential over a leftover plain one", () => {
    assert.deepEqual(
      mergePreferenceSecrets(
        { realDebridApiToken: "old", torBoxApiToken: "plain" },
        { realDebridApiToken: "new" }
      ),
      { realDebridApiToken: "new", torBoxApiToken: "plain" }
    );
  });

  it("returns null when nothing is stored", () => {
    assert.equal(mergePreferenceSecrets(null, {}), null);
    assert.deepEqual(mergePreferenceSecrets(null, { ggDealsApiKey: "gg" }), {
      ggDealsApiKey: "gg",
    });
  });

  it("detects credentials left in the plain record, even when cleared", () => {
    assert.equal(hasSecretFields(null), false);
    assert.equal(hasSecretFields({ language: "en" }), false);
    assert.equal(hasSecretFields({ torBoxApiToken: null }), true);
  });

  it("parses only known, non-empty credentials", () => {
    assert.deepEqual(
      parsePreferenceSecrets(
        JSON.stringify({ realDebridApiToken: "rd", torBoxApiToken: 5, x: "y" })
      ),
      { realDebridApiToken: "rd" }
    );
    assert.deepEqual(parsePreferenceSecrets("null"), {});
  });
});
