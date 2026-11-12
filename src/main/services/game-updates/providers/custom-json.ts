import type { UpdateAsset, UpdateRelease } from "@types";
import {
  UpdateProviderError,
  type FetchLatestOptions,
  type UpdateProvider,
} from "../update-provider.js";

interface RawCustomAsset {
  name?: string;
  url?: string;
  size?: number | null;
  sha256?: string | null;
}

interface RawCustomRelease {
  version?: string;
  tag?: string | null;
  name?: string | null;
  publishedAt?: string | null;
  pageUrl?: string | null;
  notesMarkdown?: string | null;
  isPrerelease?: boolean;
  assets?: RawCustomAsset[];
}

const stripVersionPrefix = (raw: string): string =>
  raw.trim().replace(/^v(?=\d)/i, "");

export const customJsonProvider: UpdateProvider = {
  id: "custom-json",
  displayName: "Custom JSON Feed",
  inputExample: "https://example.com",
  supportsChannels: true,
  supportsDownloads: true,

  parseInput(input: string): string | null {
    try {
      const url = new URL(input.trim());
      if (url.protocol !== "https:") return null;
      return url.toString();
    } catch {
      return null;
    }
  },

  getSourceUrl(locator: string): string {
    return locator;
  },

  async fetchLatest(
    locator: string,
    { channel, http, signal }: FetchLatestOptions
  ): Promise<UpdateRelease | null> {
    const payload = await http.getJson<RawCustomRelease | RawCustomRelease[]>(
      locator,
      { signal }
    );

    if (!payload) {
      throw new UpdateProviderError("invalid_response", "Empty JSON response");
    }

    const list = Array.isArray(payload) ? payload : [payload];

    const valid = list.filter((item) => {
      if (!item || typeof item.version !== "string" || !item.version.trim()) {
        return false;
      }
      if (channel === "stable" && item.isPrerelease) {
        return false;
      }
      return true;
    });

    const latest = valid[0];
    if (!latest || !latest.version) return null;

    const cleanVersion = stripVersionPrefix(latest.version);

    const assets: UpdateAsset[] = Array.isArray(latest.assets)
      ? latest.assets
          .filter(
            (a): a is Required<Pick<RawCustomAsset, "name" | "url">> & RawCustomAsset =>
              typeof a?.name === "string" &&
              typeof a?.url === "string" &&
              a.url.startsWith("https://")
          )
          .map((a) => ({
            name: a.name,
            url: a.url,
            size: typeof a.size === "number" ? a.size : null,
            sha256: typeof a.sha256 === "string" ? a.sha256 : null,
          }))
      : [];

    return {
      version: cleanVersion,
      tag: latest.tag ?? cleanVersion,
      name: latest.name ?? cleanVersion,
      publishedAt: latest.publishedAt ?? null,
      pageUrl: latest.pageUrl ?? locator,
      notesMarkdown: latest.notesMarkdown ?? null,
      isPrerelease: Boolean(latest.isPrerelease),
      assets,
    };
  },
};
