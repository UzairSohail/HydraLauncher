#!/usr/bin/env node
/**
 * Checks that the app's download host resolvers still work, using real links
 * from download sources. Run weekly by .github/workflows/check-hosters.yml.
 *
 * Links come from:
 *   HOSTER_CHECK_SOURCES  whitespace-separated download source JSON URLs
 *   HOSTER_CHECK_LINKS    whitespace-separated links to check directly
 *
 * For each host up to SAMPLES_PER_HOST links are tried. A host passes when any
 * link resolves to a file URL that answers a 1-byte range request. It fails
 * when every link errors for a reason other than "file not found". A host
 * that only hits Cloudflare's check (which the app passes in a window, not
 * possible here) or only finds dead links is reported as a warning.
 *
 * Writes a Markdown report to HOSTER_CHECK_REPORT (default
 * hoster-check-report.md) and exits 1 when any host failed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES_PER_HOST = 3;
const LINK_TIMEOUT_MS = 90_000;
const NEEDS_BROWSER = "NACHO_HOSTER_CHECK_NEEDS_BROWSER";

/** Hosts whose resolvers run without the app (no window, no Hydra API). */
const HOSTS = [
  {
    name: "Buzzheavier",
    api: "BuzzheavierApi",
    file: "buzzheavier",
    matches: (api, uri) => api.canHandle(uri),
    resolve: (api, uri) => api.getDownloadUrl(uri),
  },
  {
    name: "MegaDB",
    api: "MegaDbApi",
    file: "megadb",
    matches: (api, uri) => api.canHandle(uri),
    resolve: (api, uri) => api.getDownloadUrl(uri),
  },
  {
    name: "Pixeldrain",
    api: "PixelDrainApi",
    file: "pixeldrain",
    matches: (api, uri) => api.canHandle(uri),
    resolve: (api, uri) => api.unlock(uri),
  },
  {
    name: "Gofile",
    api: "GofileApi",
    file: "gofile",
    matches: (_api, uri) => uri.startsWith("https://gofile.io/d/"),
    resolve: async (api, uri) => {
      const id = new URL(uri).pathname.split("/").filter(Boolean).pop();
      const link = await api.getDownloadLink(id);
      const token = await api.authorize();
      return { url: link, headers: { Cookie: `accountToken=${token}` } };
    },
  },
  {
    name: "Mediafire",
    api: "MediafireApi",
    file: "mediafire",
    matches: (_api, uri) => uri.startsWith("https://www.mediafire.com"),
    resolve: (api, uri) => api.getDownloadUrl(uri),
  },
  {
    name: "Rootz",
    api: "RootzApi",
    file: "rootz",
    matches: (_api, uri) => uri.startsWith("https://www.rootz.so"),
    resolve: (api, uri) => api.getDownloadUrl(uri),
  },
  {
    name: "FileKeeper",
    api: "FileKeeperApi",
    file: "filekeeper",
    matches: (_api, uri) => uri.startsWith("https://filekeeper.net/"),
    resolve: (api, uri) => api.getDownloadUrl(uri),
  },
];

/** Not checked: they need a hidden app window or Hydra's API. */
const UNCHECKED_HOSTS = ["FuckingFast", "Datanodes", "VikingFile"];

const STUBS = {
  electron: `
    const fail = () => { throw new Error(${JSON.stringify(NEEDS_BROWSER)}); };
    export class BrowserWindow { constructor() { fail(); } }
    export const session = { fromPartition: fail, defaultSession: {} };
    export const app = { getPath: () => ${JSON.stringify(os.tmpdir())} };
    export default { BrowserWindow, session, app };
  `,
  logger: `
    const quiet = () => {};
    export const logger = { log: quiet, info: quiet, warn: quiet, error: quiet };
  `,
  "system-path": `
    export const SystemPath = { getPath: () => ${JSON.stringify(os.tmpdir())} };
  `,
};

const stubFor = (specifier) => {
  if (specifier === "electron") return "electron";
  if (specifier === "@main/services" || /(^|\/)logger$/.test(specifier))
    return "logger";
  if (/(^|\/)system-path$/.test(specifier)) return "system-path";
  return null;
};

const loadHosters = async (workDir) => {
  const outfile = path.join(workDir, "hosters.mjs");
  await build({
    stdin: {
      contents: HOSTS.map(
        ({ api, file }) =>
          `export { ${api} } from "./src/main/services/hosters/${file}.ts";`
      ).join("\n"),
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
    // node_modules stay external and load from the repo.
    packages: "external",
    alias: {
      "@shared": path.join(ROOT, "src/shared"),
      "@types": path.join(ROOT, "src/types"),
    },
    plugins: [
      {
        name: "stubs",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /.*/ }, (args) => {
            const stub = stubFor(args.path);
            return stub ? { path: stub, namespace: "stub" } : undefined;
          });
          pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: STUBS[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });

  // Resolve bare imports (axios, node-fetch, …) from the repo's node_modules.
  const linked = path.join(workDir, "node_modules");
  await fs.symlink(path.join(ROOT, "node_modules"), linked, "dir");
  return import(pathToFileURL(outfile).href);
};

const words = (value) => (value ?? "").split(/\s+/).filter(Boolean);

const collectLinks = async () => {
  const links = new Set(words(process.env.HOSTER_CHECK_LINKS));

  for (const sourceUrl of words(process.env.HOSTER_CHECK_SOURCES)) {
    try {
      const response = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const source = await response.json();
      // Newest uploads first: old links are more likely to be dead.
      const downloads = [...(source.downloads ?? [])].sort(
        (a, b) =>
          (Date.parse(b.uploadDate ?? "") || 0) -
          (Date.parse(a.uploadDate ?? "") || 0)
      );
      for (const download of downloads) {
        for (const uri of download.uris ?? []) links.add(uri);
      }
    } catch (error) {
      console.warn(`Could not read source ${sourceUrl}: ${error.message}`);
    }
  }

  return [...links];
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms)
    ),
  ]);

const probeFile = async ({ url, headers }) => {
  const response = await fetch(url, {
    headers: { ...headers, Range: "bytes=0-0" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  await response.body?.cancel();
  if (response.status !== 200 && response.status !== 206) {
    throw new Error(`file URL answered HTTP ${response.status}`);
  }
};

const classify = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes(NEEDS_BROWSER)) return "browser";
  if (/not.?found|HosterUnlockFileNotFound|404/i.test(message))
    return "not_found";
  return "error";
};

const checkHost = async (host, api, links) => {
  const attempts = [];
  for (const uri of links.slice(0, SAMPLES_PER_HOST)) {
    try {
      const resolved = await withTimeout(
        host.resolve(api, uri),
        LINK_TIMEOUT_MS
      );
      const target =
        typeof resolved === "string" ? { url: resolved } : resolved;
      await probeFile(target);
      attempts.push({ uri, kind: "ok" });
      break;
    } catch (error) {
      attempts.push({
        uri,
        kind: classify(error),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const kinds = new Set(attempts.map((a) => a.kind));
  const status =
    attempts.length === 0
      ? "no_links"
      : kinds.has("ok")
        ? "ok"
        : kinds.has("error")
          ? "failed"
          : "warning";

  return { host: host.name, status, attempts };
};

const ICONS = {
  ok: "✅ Works",
  failed: "❌ Broken",
  warning: "⚠️ Inconclusive",
  no_links: "➖ No links found",
};

const NOTES = {
  browser: "Cloudflare check (the app shows a window for this)",
  not_found: "file gone (dead link, not a resolver problem)",
  error: "resolver error",
};

const report = (results) => {
  const lines = [
    "# Download host check",
    "",
    "| Host | Result | Details |",
    "| --- | --- | --- |",
  ];
  for (const { host, status, attempts } of results) {
    const details = attempts
      .filter((a) => a.kind !== "ok")
      .map((a) => `${NOTES[a.kind]}: ${a.message}`)
      .join("<br>")
      .replace(/\|/g, "\\|");
    lines.push(`| ${host} | ${ICONS[status]} | ${details || ""} |`);
  }
  lines.push(
    "",
    `Not checked here (need an app window or Hydra's API): ${UNCHECKED_HOSTS.join(", ")}.`
  );
  return lines.join("\n");
};

const main = async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "hoster-check-"));
  try {
    const apis = await loadHosters(workDir);
    const links = await collectLinks();
    console.log(`Collected ${links.length} links`);

    const results = [];
    for (const host of HOSTS) {
      const api = apis[host.api];
      const hostLinks = links.filter((uri) => {
        try {
          return host.matches(api, uri);
        } catch {
          return false;
        }
      });
      const result = await checkHost(host, api, hostLinks);
      console.log(`${host.name}: ${result.status}`);
      results.push(result);
    }

    const markdown = report(results);
    const reportPath =
      process.env.HOSTER_CHECK_REPORT ?? "hoster-check-report.md";
    await fs.writeFile(reportPath, `${markdown}\n`);
    console.log(`\n${markdown}`);

    if (results.some((r) => r.status === "failed")) process.exitCode = 1;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
};

await main();
