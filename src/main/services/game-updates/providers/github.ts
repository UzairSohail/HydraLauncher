import type { UpdateProvider } from "../update-provider.js";
import {
  parseGithubStyleReleases,
  parseOwnerRepo,
  pickChannelRelease,
} from "./shared.js";

export const githubProvider: UpdateProvider = {
  id: "github",
  displayName: "GitHub",
  inputExample: "https://github.com/owner/repo",
  supportsChannels: true,
  supportsDownloads: true,

  parseInput: (input) => parseOwnerRepo(input, "github.com"),

  getSourceUrl: (locator) => `https://github.com/${locator}/releases`,

  async fetchLatest(locator, { channel, http, signal }) {
    const payload = await http.getJson<unknown>(
      `https://api.github.com/repos/${locator}/releases?per_page=20`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal,
      }
    );
    return pickChannelRelease(parseGithubStyleReleases(payload), channel);
  },
};
