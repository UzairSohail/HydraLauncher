import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProviderHttp } from "../update-provider.js";
import { codebergProvider } from "./codeberg.js";
import { githubProvider } from "./github.js";
import { gitlabProvider, parseGitlabInput } from "./gitlab.js";
import { itchioProvider, parseItchInput } from "./itchio.js";

const httpReturning = (
  payload: unknown,
  seen: string[] = []
): ProviderHttp => ({
  getJson: async <T>(url: string) => {
    seen.push(url);
    return payload as T;
  },
});

const githubRelease = (
  tag: string,
  options: { prerelease?: boolean; draft?: boolean } = {}
) => ({
  tag_name: tag,
  name: `Release ${tag}`,
  draft: options.draft ?? false,
  prerelease: options.prerelease ?? false,
  published_at: "2026-11-01T00:00:00Z",
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  body: "notes",
  assets: [
    {
      name: `port-${tag}-windows.zip`,
      size: 100,
      browser_download_url: `https://github.com/o/r/releases/download/${tag}/port-windows.zip`,
      digest: `sha256:${"a".repeat(64)}`,
    },
  ],
});

describe("GitHub provider", () => {
  it("accepts owner/repo and repository URLs", () => {
    assert.equal(githubProvider.parseInput("owner/repo"), "owner/repo");
    assert.equal(
      githubProvider.parseInput("https://github.com/owner/repo/releases"),
      "owner/repo"
    );
    assert.equal(
      githubProvider.parseInput("github.com/owner/repo.git"),
      "owner/repo"
    );
    assert.equal(
      githubProvider.parseInput("https://gitlab.com/owner/repo"),
      null
    );
    assert.equal(githubProvider.parseInput("just-a-name"), null);
  });

  it("skips drafts and pre-releases on the stable channel", async () => {
    const seen: string[] = [];
    const http = httpReturning(
      [
        githubRelease("v2.0.0", { draft: true }),
        githubRelease("v1.5.0-rc1", { prerelease: true }),
        githubRelease("v1.4.0"),
      ],
      seen
    );

    const stable = await githubProvider.fetchLatest("o/r", {
      channel: "stable",
      http,
    });
    const pre = await githubProvider.fetchLatest("o/r", {
      channel: "prerelease",
      http,
    });

    assert.equal(
      seen[0],
      "https://api.github.com/repos/o/r/releases?per_page=20"
    );
    assert.equal(stable?.version, "1.4.0");
    assert.equal(stable?.assets[0].sha256, "a".repeat(64));
    assert.equal(pre?.version, "1.5.0-rc1");
  });

  it("rejects payloads that aren't release lists", async () => {
    await assert.rejects(
      githubProvider.fetchLatest("o/r", {
        channel: "stable",
        http: httpReturning({ message: "Not Found" }),
      })
    );
  });
});

describe("Codeberg provider", () => {
  it("reads Forgejo releases", async () => {
    const seen: string[] = [];
    const release = await codebergProvider.fetchLatest("o/r", {
      channel: "stable",
      http: httpReturning([githubRelease("1.0.0")], seen),
    });

    assert.equal(
      codebergProvider.parseInput("https://codeberg.org/o/r"),
      "o/r"
    );
    assert.equal(
      seen[0],
      "https://codeberg.org/api/v1/repos/o/r/releases?limit=20"
    );
    assert.equal(release?.version, "1.0.0");
  });
});

describe("GitLab provider", () => {
  it("parses gitlab.com, nested groups and self-hosted URLs", () => {
    assert.equal(parseGitlabInput("group/project"), "gitlab.com/group/project");
    assert.equal(
      parseGitlabInput("https://gitlab.com/group/sub/project/-/releases"),
      "gitlab.com/group/sub/project"
    );
    assert.equal(
      parseGitlabInput("https://git.example.org/team/port"),
      "git.example.org/team/port"
    );
    assert.equal(parseGitlabInput("http://git.example.org/team/port"), null);
    assert.equal(parseGitlabInput("project"), null);
  });

  it("encodes the project path and reads release links", async () => {
    const seen: string[] = [];
    const release = await gitlabProvider.fetchLatest(
      "gitlab.com/group/sub/project",
      {
        channel: "stable",
        http: httpReturning(
          [
            {
              tag_name: "v3.0.0",
              upcoming_release: true,
              assets: { links: [] },
            },
            {
              tag_name: "v2.1.0",
              name: "2.1",
              released_at: "2026-10-01T00:00:00Z",
              _links: {
                self: "https://gitlab.com/group/sub/project/-/releases/v2.1.0",
              },
              assets: {
                links: [
                  {
                    name: "port-linux.AppImage",
                    url: "https://gitlab.com/x",
                    direct_asset_url:
                      "https://gitlab.com/direct/port-linux.AppImage",
                  },
                ],
              },
            },
          ],
          seen
        ),
      }
    );

    assert.equal(
      seen[0],
      "https://gitlab.com/api/v4/projects/group%2Fsub%2Fproject/releases?per_page=20"
    );
    assert.equal(release?.version, "2.1.0");
    assert.equal(
      release?.assets[0].url,
      "https://gitlab.com/direct/port-linux.AppImage"
    );
    assert.equal(release?.assets[0].size, null);
  });
});

describe("itch.io provider", () => {
  it("needs a channel and accepts page URLs", () => {
    assert.equal(parseItchInput("Dev/Game:windows"), "dev/game:windows");
    assert.equal(
      parseItchInput("https://dev.itch.io/game:linux-64"),
      "dev/game:linux-64"
    );
    assert.equal(parseItchInput("dev/game"), null);
    assert.equal(parseItchInput("https://dev.itch.io/game"), null);
  });

  it("reports the channel version as a manual update", async () => {
    const seen: string[] = [];
    const release = await itchioProvider.fetchLatest("dev/game:windows", {
      channel: "stable",
      http: httpReturning({ latest: "1.0.4" }, seen),
    });

    assert.equal(
      seen[0],
      "https://itch.io/api/1/x/wharf/latest?target=dev%2Fgame&channel_name=windows"
    );
    assert.equal(release?.version, "1.0.4");
    assert.equal(release?.pageUrl, "https://dev.itch.io/game");
    assert.deepEqual(release?.assets, []);
  });

  it("fails when the channel has no user version", async () => {
    await assert.rejects(
      itchioProvider.fetchLatest("dev/game:windows", {
        channel: "stable",
        http: httpReturning({}),
      })
    );
  });
});
