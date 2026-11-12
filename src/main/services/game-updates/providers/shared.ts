import type { UpdateAsset, UpdateChannel, UpdateRelease } from "@types";

import { UpdateProviderError } from "../update-provider.js";

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/i;
const PRERELEASE_SUFFIX =
  /[-.+_](alpha|beta|rc|pre|preview|dev|nightly|canary)/i;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const asString = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value : null;

export const stripVersionPrefix = (tag: string) =>
  tag.trim().replace(/^v(?=\d)/i, "");

export const looksLikePrerelease = (tag: string) => PRERELEASE_SUFFIX.test(tag);

const isHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

/**
 * Reads `owner/repo` either as typed or from a URL on `host`, ignoring any
 * trailing page such as `/releases`.
 */
export const parseOwnerRepo = (input: string, host: string) => {
  let value = input.trim();
  if (!value) return null;

  if (/^https?:\/\//i.test(value) || value.toLowerCase().startsWith(host)) {
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== host) return null;
    value = url.pathname;
  }

  const [owner, rawRepo] = value.replace(/^\/+/, "").split("/");
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo)) {
    return null;
  }
  return `${owner}/${repo}`;
};

export const toAsset = (
  name: unknown,
  url: unknown,
  size: unknown,
  digest?: unknown
): UpdateAsset | null => {
  const assetName = asString(name);
  const assetUrl = asString(url);
  if (!assetName || !assetUrl || !isHttpsUrl(assetUrl)) return null;

  const sha = typeof digest === "string" ? SHA256_DIGEST.exec(digest) : null;
  return {
    name: assetName,
    url: assetUrl,
    size: typeof size === "number" && size >= 0 ? size : null,
    sha256: sha ? sha[1].toLowerCase() : null,
  };
};

/** Picks the newest release allowed by the channel from a newest-first list. */
export const pickChannelRelease = (
  releases: UpdateRelease[],
  channel: UpdateChannel
) =>
  releases.find(
    (release) => channel === "prerelease" || !release.isPrerelease
  ) ?? null;

/**
 * GitHub and Forgejo (Codeberg) return releases in the same shape.
 */
export const parseGithubStyleReleases = (payload: unknown): UpdateRelease[] => {
  if (!Array.isArray(payload)) {
    throw new UpdateProviderError("invalid_response");
  }

  return payload.flatMap((item): UpdateRelease[] => {
    if (!isRecord(item) || item.draft === true) return [];
    const tag = asString(item.tag_name);
    if (!tag) return [];

    const assets = Array.isArray(item.assets)
      ? item.assets.flatMap((asset) => {
          if (!isRecord(asset)) return [];
          const parsed = toAsset(
            asset.name,
            asset.browser_download_url,
            asset.size,
            asset.digest
          );
          return parsed ? [parsed] : [];
        })
      : [];

    return [
      {
        version: stripVersionPrefix(tag),
        tag,
        name: asString(item.name),
        publishedAt: asString(item.published_at) ?? asString(item.created_at),
        pageUrl: asString(item.html_url),
        notesMarkdown: asString(item.body),
        isPrerelease: item.prerelease === true,
        assets,
      },
    ];
  });
};
