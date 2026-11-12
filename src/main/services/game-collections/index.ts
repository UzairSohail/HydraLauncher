import { randomUUID } from "node:crypto";

import type { GameCollection, GameShop, LocalGameCollection } from "@types";
import { gameCollectionsSublevel, gamesSublevel } from "@main/level";

import {
  libraryWriteQueue,
  markCollectionOrderChanged,
} from "../library-sync/library-write-queue";
import { WindowManager } from "../window-manager";
import {
  collectionGameKey,
  getCollectionPositionMaps,
  isCollectionNameTaken,
  planGameCollectionFields,
  reorderCollection,
  setGameMembership,
} from "./collection-model";

/**
 * Library collections kept on this device instead of in a Hydra account.
 * Settings sync carries them between devices through Google Drive; callers
 * that change them should call `SettingsSync.scheduleSync()`.
 */
export class GameCollections {
  public static all(): Promise<LocalGameCollection[]> {
    return gameCollectionsSublevel.values().all();
  }

  /** Collections with how many games in this device's library are in each. */
  public static async list(): Promise<GameCollection[]> {
    const [collections, games] = await Promise.all([
      this.all(),
      gamesSublevel.values().all(),
    ]);
    const localKeys = new Set(
      games.filter((game) => !game.isDeleted).map(collectionGameKey)
    );

    return collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      gamesCount: collection.games.filter((key) => localKeys.has(key)).length,
    }));
  }

  public static async create(name: string): Promise<GameCollection> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("game/collection-name-required");
    if (isCollectionNameTaken(await this.all(), trimmed)) {
      throw new Error("game/collection-name-already-in-use");
    }

    const collection: LocalGameCollection = {
      id: randomUUID(),
      name: trimmed,
      createdAt: Date.now(),
      ordered: false,
      games: [],
    };
    await gameCollectionsSublevel.put(collection.id, collection);
    return { id: collection.id, name: collection.name, gamesCount: 0 };
  }

  public static async rename(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("game/collection-name-required");

    const collections = await this.all();
    const collection = collections.find((item) => item.id === id);
    if (!collection) throw new Error("game/collection-not-found");
    if (isCollectionNameTaken(collections, trimmed, id)) {
      throw new Error("game/collection-name-already-in-use");
    }

    await gameCollectionsSublevel.put(id, { ...collection, name: trimmed });
  }

  public static async remove(id: string) {
    await gameCollectionsSublevel.del(id);
    await this.reconcile({ removedIds: new Set([id]) });
  }

  /** Puts one game in exactly the listed collections. */
  public static async assign(
    shop: GameShop,
    objectId: string,
    collectionIds: string[]
  ) {
    const gameKey = collectionGameKey({ shop, objectId });
    const changed = setGameMembership(await this.all(), gameKey, collectionIds);
    if (changed.length > 0) {
      await gameCollectionsSublevel.batch(
        changed.map((collection) => ({
          type: "put" as const,
          key: collection.id,
          value: collection,
        }))
      );
    }
    await this.reconcile({ onlyKeys: new Set([gameKey]) });
  }

  public static async setOrder(
    collectionId: string,
    games: { shop: GameShop; objectId: string }[]
  ) {
    const collection = await gameCollectionsSublevel
      .get(collectionId)
      .catch(() => undefined);
    if (!collection) throw new Error("game/collection-not-found");

    const next = reorderCollection(collection, games.map(collectionGameKey));
    await gameCollectionsSublevel.put(collectionId, next);
    await this.reconcile({ onlyKeys: new Set(next.games) });
    markCollectionOrderChanged(collectionId);
  }

  /** Applies collections that came in from another device. */
  public static async applySynced(
    upserts: LocalGameCollection[],
    deletedIds: string[]
  ) {
    if (upserts.length === 0 && deletedIds.length === 0) return;

    await gameCollectionsSublevel.batch([
      ...deletedIds.map((key) => ({ type: "del" as const, key })),
      ...upserts.map((collection) => ({
        type: "put" as const,
        key: collection.id,
        value: collection,
      })),
    ]);
    await this.reconcile({ removedIds: new Set(deletedIds) });
    WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  /**
   * Brings game records in line with the collections, for example after a
   * game that a synced collection lists is added to this device's library.
   */
  public static async reconcile(
    options: { onlyKeys?: Set<string>; removedIds?: Set<string> } = {}
  ) {
    await libraryWriteQueue.run(async () => {
      const collections = await this.all();
      const positionMaps = getCollectionPositionMaps(collections);
      const entries = await gamesSublevel.iterator().all();

      const updates = entries.flatMap(([key, game]) => {
        if (
          options.onlyKeys &&
          !options.onlyKeys.has(collectionGameKey(game))
        ) {
          return [];
        }
        const fields = planGameCollectionFields(
          game,
          collections,
          positionMaps,
          options.removedIds
        );
        return fields
          ? [{ type: "put" as const, key, value: { ...game, ...fields } }]
          : [];
      });

      if (updates.length > 0) await gamesSublevel.batch(updates);
    });
  }
}
