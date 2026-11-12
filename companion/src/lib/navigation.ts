import { router } from "expo-router";

export const openGame = (game: {
  shop: string;
  objectId: string;
  title: string;
}) =>
  router.push({
    pathname: "/game/[shop]/[objectId]",
    params: { shop: game.shop, objectId: game.objectId, title: game.title },
  });
