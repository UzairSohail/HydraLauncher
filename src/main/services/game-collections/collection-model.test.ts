import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LocalGameCollection } from "@types";
import {
  collectionGameKey,
  getCollectionPositionMaps,
  isCollectionNameTaken,
  parseCollectionGameKey,
  planGameCollectionFields,
  reorderCollection,
  setGameMembership,
} from "./collection-model.js";

const collection = (
  id: string,
  games: string[],
  ordered = false
): LocalGameCollection => ({
  id,
  name: id,
  createdAt: 1,
  ordered,
  games,
});

describe("collection keys", () => {
  it("round-trips a key whose object ID has a colon", () => {
    const game = { shop: "custom" as const, objectId: "a:b" };
    assert.deepEqual(parseCollectionGameKey(collectionGameKey(game)), game);
  });

  it("matches names ignoring case and spaces, except the one being renamed", () => {
    const items = [{ ...collection("1", []), name: "RPGs" }];
    assert.equal(isCollectionNameTaken(items, "  rpgs "), true);
    assert.equal(isCollectionNameTaken(items, "rpgs", "1"), false);
  });
});

describe("setGameMembership", () => {
  it("adds to the end and removes, touching only what changed", () => {
    const changed = setGameMembership(
      [
        collection("a", ["steam:1"]),
        collection("b", ["steam:2", "steam:9"]),
        collection("c", []),
      ],
      "steam:9",
      ["a", "c"]
    );

    assert.deepEqual(
      changed.map((item) => [item.id, item.games]),
      [
        ["a", ["steam:1", "steam:9"]],
        ["b", ["steam:2"]],
        ["c", ["steam:9"]],
      ]
    );
  });
});

describe("reorderCollection", () => {
  it("keeps members missing from the request in their slot", () => {
    const next = reorderCollection(
      collection("a", ["steam:1", "steam:2", "steam:3", "steam:4"]),
      ["steam:4", "steam:1", "steam:3", "steam:99"]
    );

    assert.equal(next.ordered, true);
    assert.deepEqual(next.games, ["steam:4", "steam:2", "steam:1", "steam:3"]);
  });
});

describe("planGameCollectionFields", () => {
  const collections = [
    collection("a", ["steam:2", "steam:1"], true),
    collection("b", ["steam:1"]),
    collection("c", []),
  ];
  const maps = getCollectionPositionMaps(collections);

  it("derives membership and custom positions from the collections", () => {
    assert.deepEqual(
      planGameCollectionFields(
        { shop: "steam", objectId: "1", collectionIds: ["c"] },
        collections,
        maps
      ),
      { collectionIds: ["a", "b"], collectionPositions: { a: 1 } }
    );
  });

  it("keeps unknown collection IDs unless they were removed", () => {
    const game = {
      shop: "steam" as const,
      objectId: "5",
      collectionIds: ["old", "gone"],
      collectionPositions: { old: 3, gone: 1 },
    };

    assert.deepEqual(
      planGameCollectionFields(game, collections, maps, new Set(["gone"])),
      { collectionIds: ["old"], collectionPositions: { old: 3 } }
    );
  });

  it("returns null when the record already matches", () => {
    assert.equal(
      planGameCollectionFields(
        {
          shop: "steam",
          objectId: "2",
          collectionIds: ["a"],
          collectionPositions: { a: 0 },
        },
        collections,
        maps
      ),
      null
    );
  });
});
