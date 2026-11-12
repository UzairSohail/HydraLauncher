import type { CompanionRepack } from "../../../src/shared/companion";
import { API_URL } from "./config";

export interface CatalogueGame {
  objectId: string;
  shop: string;
  title: string;
  libraryImageUrl?: string | null;
  coverImageUrl?: string | null;
  libraryHeroImageUrl?: string | null;
  iconUrl?: string | null;
  logoImageUrl?: string | null;
  genres?: string[];
  releaseYear?: number | null;
  description?: string | null;
}

export type Repack = CompanionRepack;

export type CatalogueCategory = "hot" | "weekly" | "achievements";

/** Same identification the launcher sends. */
const HEADERS = {
  "User-Agent": "Hydra Launcher v4.4.0",
  Accept: "application/json",
};

/** Arrays go out as `key[]=a&key[]=b`, the way the launcher sends them. */
const query = (params: Record<string, string | number | string[]>) => {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        parts.push(`${encodeURIComponent(key)}[]=${encodeURIComponent(item)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.join("&");
};

const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...HEADERS, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new Error(`The catalogue returned ${response.status}`);
  }
  return response.json() as Promise<T>;
};

export const getCategory = (
  category: CatalogueCategory,
  downloadSourceIds: string[]
) =>
  call<CatalogueGame[]>(
    `/catalogue/${category}?${query({ take: 24, skip: 0, downloadSourceIds })}`
  ).then((games) => (Array.isArray(games) ? games : []));

export const searchCatalogue = (
  title: string,
  skip: number,
  downloadSourceIds: string[]
) =>
  call<{ edges: CatalogueGame[]; count: number }>("/catalogue/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      sortBy: "popularity",
      sortOrder: "desc",
      downloadSourceFingerprints: [],
      tags: [],
      publishers: [],
      genres: [],
      developers: [],
      protondbSupportBadges: [],
      deckCompatibility: [],
      platforms: [],
      take: 24,
      skip,
      downloadSourceIds,
    }),
  });

export const getAssets = (shop: string, objectId: string) =>
  call<CatalogueGame | null>(
    `/games/${encodeURIComponent(shop)}/${encodeURIComponent(objectId)}/assets`
  );

export const getDownloadOptions = (
  shop: string,
  objectId: string,
  downloadSourceIds: string[]
) =>
  call<Repack[]>(
    `/games/${encodeURIComponent(shop)}/${encodeURIComponent(objectId)}/download-sources?${query(
      { take: 100, skip: 0, downloadSourceIds }
    )}`
  ).then((repacks) => (Array.isArray(repacks) ? repacks : []));

/** Registers a source by its URL, which is how it gets the ID the catalogue uses. */
export const registerDownloadSource = (url: string) =>
  call<{ id: string; name: string; url: string }>("/download-sources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

/** A portrait image for a game, preferring the catalogue's own. */
export const coverImage = (game: Partial<CatalogueGame> & { shop: string; objectId: string }) =>
  game.libraryImageUrl ||
  game.coverImageUrl ||
  (game.shop === "steam"
    ? `https://shared.steamstatic.com/store_item_assets/steam/apps/${game.objectId}/library_600x900.jpg`
    : null);
