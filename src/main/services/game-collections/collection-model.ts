import type { GameShop, LocalGameCollection } from "@types";
import {
  getLibraryCollectionIds,
  getLibraryCollectionOrderPositions,
} from "../../../shared/library-group-actions.js";

/**
 * Pure rules for local collections. A collection's `games` list is the source
 * of truth for membership and custom order; each game record's
 * `collectionIds` and `collectionPositions` are kept in step from it.
 */

export interface CollectionMember {
  shop: GameShop;
  objectId: string;
}

export interface CollectionGameFields extends CollectionMember {
  collectionIds?: string[] | null;
  collectionId?: string | null;
  collectionPositions?: Record<string, number>;
}

export const collectionGameKey = (game: CollectionMember) =>
  `${game.shop}:${game.objectId}`;

export const parseCollectionGameKey = (key: string): CollectionMember => {
  const separator = key.indexOf(":");
  return {
    shop: key.slice(0, separator) as GameShop,
    objectId: key.slice(separator + 1),
  };
};

export const normalizeCollectionName = (name: string) =>
  name.trim().toLocaleLowerCase();

export const isCollectionNameTaken = (
  collections: readonly LocalGameCollection[],
  name: string,
  exceptId?: string
) => {
  const normalized = normalizeCollectionName(name);
  return collections.some(
    (collection) =>
      collection.id !== exceptId &&
      normalizeCollectionName(collection.name) === normalized
  );
};

/** Puts a game in exactly the listed collections. Returns the ones that changed. */
export const setGameMembership = (
  collections: readonly LocalGameCollection[],
  gameKey: string,
  collectionIds: readonly string[]
): LocalGameCollection[] => {
  const wanted = new Set(collectionIds);
  const changed: LocalGameCollection[] = [];

  for (const collection of collections) {
    const isMember = collection.games.includes(gameKey);
    const shouldBeMember = wanted.has(collection.id);
    if (isMember === shouldBeMember) continue;

    changed.push({
      ...collection,
      games: shouldBeMember
        ? [...collection.games, gameKey]
        : collection.games.filter((key) => key !== gameKey),
    });
  }

  return changed;
};

/**
 * Applies a custom order. The requested games take the slots the same games
 * held before, so members missing from the request (not on this device, or
 * hidden) keep their place.
 */
export const reorderCollection = (
  collection: LocalGameCollection,
  requestedKeys: readonly string[]
): LocalGameCollection => {
  const members = new Set(collection.games);
  const requested = [...new Set(requestedKeys)].filter((key) =>
    members.has(key)
  );
  const requestedSet = new Set(requested);
  let next = 0;

  return {
    ...collection,
    ordered: true,
    games: collection.games.map((key) =>
      requestedSet.has(key) ? requested[next++] : key
    ),
  };
};

/** Position maps for the collections that have a custom order. */
export const getCollectionPositionMaps = (
  collections: readonly LocalGameCollection[]
) => {
  const maps = new Map<string, Map<string, number>>();
  for (const collection of collections) {
    if (!collection.ordered) continue;
    maps.set(
      collection.id,
      getLibraryCollectionOrderPositions(
        collection.games.map(parseCollectionGameKey)
      )
    );
  }
  return maps;
};

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The collection fields a game record should have. Collection IDs this device
 * doesn't know (left over from a Hydra account, say) are kept unless listed
 * in `removedIds`. Returns null when nothing changes.
 */
export const planGameCollectionFields = (
  game: CollectionGameFields,
  collections: readonly LocalGameCollection[],
  positionMaps: ReadonlyMap<string, ReadonlyMap<string, number>>,
  removedIds: ReadonlySet<string> = new Set()
): {
  collectionIds: string[];
  collectionPositions: Record<string, number>;
} | null => {
  const key = collectionGameKey(game);
  const known = new Set(collections.map((collection) => collection.id));
  const memberOf = collections
    .filter((collection) => collection.games.includes(key))
    .map((collection) => collection.id);

  const current = getLibraryCollectionIds(game);
  const kept = current.filter(
    (id) => !removedIds.has(id) && (!known.has(id) || memberOf.includes(id))
  );
  const collectionIds = [
    ...kept,
    ...memberOf.filter((id) => !kept.includes(id)),
  ];

  const collectionPositions: Record<string, number> = {};
  for (const [id, position] of Object.entries(game.collectionPositions ?? {})) {
    if (!known.has(id) && !removedIds.has(id) && collectionIds.includes(id)) {
      collectionPositions[id] = position;
    }
  }
  for (const id of memberOf) {
    const position = positionMaps.get(id)?.get(key);
    if (position !== undefined) collectionPositions[id] = position;
  }

  const unchanged =
    sameJson(current, collectionIds) &&
    sameJson(game.collectionPositions ?? {}, collectionPositions);

  return unchanged ? null : { collectionIds, collectionPositions };
};
