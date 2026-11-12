import type { UpdateProvider } from "../update-provider.js";
import {
  parseGithubStyleReleases,
  parseOwnerRepo,
  pickChannelRelease,
} from "./shared.js";

export const codebergProvider: UpdateProvider = {
  id: "codeberg",
  displayName: "Codeberg",
  inputExample: "https://codeberg.org/owner/repo",
  supportsChannels: true,
  supportsDownloads: true,

  parseInput: (input) => parseOwnerRepo(input, "codeberg.org"),

  getSourceUrl: (locator) => `https://codeberg.org/${locator}/releases`,

  async fetchLatest(locator, { channel, http, signal }) {
    const payload = await http.getJson<unknown>(
      `https://codeberg.org/api/v1/repos/${locator}/releases?limit=20`,
      { headers: { Accept: "application/json" }, signal }
    );
    return pickChannelRelease(parseGithubStyleReleases(payload), channel);
  },
};
