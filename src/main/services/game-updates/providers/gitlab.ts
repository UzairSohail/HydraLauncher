import type { UpdateRelease } from "@types";

import {
  UpdateProviderError,
  type UpdateProvider,
} from "../update-provider.js";
import {
  asString,
  isRecord,
  looksLikePrerelease,
  pickChannelRelease,
  stripVersionPrefix,
  toAsset,
} from "./shared.js";

const DEFAULT_HOST = "gitlab.com";
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** Locators are `host/group/.../project`, so self-hosted instances work too. */
export const parseGitlabInput = (input: string) => {
  const value = input.trim();
  if (!value) return null;

  let host = DEFAULT_HOST;
  let pathname = value;
  if (/^https?:\/\//i.test(value) || /^[^/]+\.[^/]+\//.test(value)) {
    try {
      const url = new URL(
        /^https?:\/\//i.test(value) ? value : `https://${value}`
      );
      if (url.protocol !== "https:" || url.username || url.password)
        return null;
      host = url.host.toLowerCase();
      pathname = url.pathname;
    } catch {
      return null;
    }
  }
  if (!HOST.test(host)) return null;

  const segments = pathname
    .split("/-/")[0]
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2 || !segments.every((part) => SEGMENT.test(part))) {
    return null;
  }
  return `${host}/${segments.join("/")}`;
};

const splitLocator = (locator: string) => {
  const index = locator.indexOf("/");
  return { host: locator.slice(0, index), project: locator.slice(index + 1) };
};

export const parseGitlabReleases = (payload: unknown): UpdateRelease[] => {
  if (!Array.isArray(payload)) {
    throw new UpdateProviderError("invalid_response");
  }

  return payload.flatMap((item): UpdateRelease[] => {
    if (!isRecord(item)) return [];
    const tag = asString(item.tag_name);
    if (!tag) return [];

    const links =
      isRecord(item.assets) && Array.isArray(item.assets.links)
        ? item.assets.links
        : [];
    const assets = links.flatMap((link) => {
      if (!isRecord(link)) return [];
      const asset = toAsset(link.name, link.direct_asset_url ?? link.url, null);
      return asset ? [asset] : [];
    });

    return [
      {
        version: stripVersionPrefix(tag),
        tag,
        name: asString(item.name),
        publishedAt: asString(item.released_at) ?? asString(item.created_at),
        pageUrl: isRecord(item._links) ? asString(item._links.self) : null,
        notesMarkdown: asString(item.description),
        isPrerelease:
          item.upcoming_release === true || looksLikePrerelease(tag),
        assets,
      },
    ];
  });
};

export const gitlabProvider: UpdateProvider = {
  id: "gitlab",
  displayName: "GitLab",
  inputExample: "https://gitlab.com/group/project",
  supportsChannels: true,
  supportsDownloads: true,

  parseInput: parseGitlabInput,

  getSourceUrl: (locator) => `https://${locator}/-/releases`,

  async fetchLatest(locator, { channel, http, signal }) {
    const { host, project } = splitLocator(locator);
    const payload = await http.getJson<unknown>(
      `https://${host}/api/v4/projects/${encodeURIComponent(project)}/releases?per_page=20`,
      { headers: { Accept: "application/json" }, signal }
    );
    return pickChannelRelease(parseGitlabReleases(payload), channel);
  },
};
