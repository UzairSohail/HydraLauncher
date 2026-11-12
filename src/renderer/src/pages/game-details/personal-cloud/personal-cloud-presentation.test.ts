import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PersonalCloudGameInfo, PersonalCloudGameState } from "@types";

import { getPersonalCloudPresentation } from "./personal-cloud-presentation.js";

const status = {
  signedIn: true,
  paused: false,
  stateDir: "/state",
  phoneSignInAvailable: false,
};
const info = (overrides: Partial<PersonalCloudGameInfo> = {}) =>
  ({
    gameId: "game",
    name: "Game",
    inCatalogue: true,
    status: "up_to_date",
    statusLabel: "Up to date",
    localFiles: 1,
    localBytes: 1,
    versions: [],
    ...overrides,
  }) as PersonalCloudGameInfo;
const state = (
  overrides: Partial<PersonalCloudGameState> = {}
): PersonalCloudGameState => ({ status, info: info(), ...overrides });

describe("getPersonalCloudPresentation", () => {
  it("shows syncing while an action runs", () => {
    assert.equal(
      getPersonalCloudPresentation(state(), true).labelKey,
      "syncing"
    );
  });

  it("is off when signed out or the game can't be linked", () => {
    assert.equal(
      getPersonalCloudPresentation(
        state({ status: { ...status, signedIn: false } }),
        false
      ).labelKey,
      "widget_off"
    );
    assert.equal(
      getPersonalCloudPresentation(state({ info: null }), false).labelKey,
      "widget_off"
    );
  });

  it("maps sync status to a tone", () => {
    assert.deepEqual(getPersonalCloudPresentation(state(), false), {
      labelKey: "status_up_to_date",
      tone: "synced",
    });
    assert.equal(
      getPersonalCloudPresentation(
        state({ info: info({ status: "cloud_newer" }) }),
        false
      ).tone,
      "outdated"
    );
    assert.equal(
      getPersonalCloudPresentation(
        state({ info: info({ status: "both_changed" }) }),
        false
      ).tone,
      "conflict"
    );
  });

  it("shows paused and not-yet-known games", () => {
    assert.equal(
      getPersonalCloudPresentation(
        state({ status: { ...status, paused: true } }),
        false
      ).labelKey,
      "paused"
    );
    assert.equal(
      getPersonalCloudPresentation(
        state({ info: info({ inCatalogue: false }) }),
        false
      ).labelKey,
      "status_no_saves_yet"
    );
  });
});
