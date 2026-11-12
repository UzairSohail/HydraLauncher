import fs from "node:fs";
import path from "node:path";

import { logger, SystemPath } from "@main/services";
import recompilationSaves from "./recompilation-saves.json";
import { resolveRecompilationPath } from "./recompilation-paths";

const SNAPSHOTS_TO_KEEP = 5;
const MANIFEST_FILE = "snapshot.json";

interface SaveMapEntry {
  kind?: string;
  id?: string;
  path?: string;
  paths?: Partial<Record<"windows" | "linux" | "mac", string>>;
}

const SAVE_MAP = recompilationSaves as Record<
  string,
  { saves: SaveMapEntry[] } | undefined
>;

const platformKey = () => {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
};

interface SaveTemplate {
  id: string;
  template: string;
}

const getSaveTemplates = (slug: string): SaveTemplate[] =>
  (SAVE_MAP[slug]?.saves ?? []).flatMap((entry) => {
    const template = entry.path ?? entry.paths?.[platformKey()];
    return template ? [{ id: entry.id ?? template, template }] : [];
  });

const exists = (target: string) =>
  fs.promises
    .access(target)
    .then(() => true)
    .catch(() => false);

/** Expands a `*` in the last segment, as used by some save rules. */
const expandTemplate = async (template: string, baseDirectory: string) => {
  const resolved = resolveRecompilationPath(template, baseDirectory);
  const name = path.basename(resolved);
  if (!name.includes("*")) return (await exists(resolved)) ? [resolved] : [];

  const directory = path.dirname(resolved);
  const pattern = new RegExp(
    `^${name
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`
  );
  const entries = await fs.promises.readdir(directory).catch(() => []);
  return entries
    .filter((entry) => pattern.test(entry))
    .map((entry) => path.join(directory, entry));
};

export const hasRecompilationSaveRules = (slug: string) =>
  getSaveTemplates(slug).length > 0;

export const getRecompilationSnapshotsDirectory = (slug: string) =>
  path.join(
    SystemPath.getPath("userData"),
    "recompilation-save-snapshots",
    slug
  );

const listSnapshots = async (slug: string) => {
  const root = getRecompilationSnapshotsDirectory(slug);
  const entries = await fs.promises
    .readdir(root, { withFileTypes: true })
    .catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
};

export const countRecompilationSnapshots = async (slug: string) =>
  (await listSnapshots(slug)).length;

const safeName = (value: string) =>
  value.replace(/[<>:"/\\|?*\s]+/g, "_").replace(/^_+|_+$/g, "") || "save";

/**
 * Copies every save the port's rules point at into a timestamped folder.
 * Returns the folder, or null when there was nothing to copy.
 */
export const snapshotRecompilationSaves = async (
  slug: string,
  baseDirectory: string,
  label: string
) => {
  const sources: string[] = [];
  for (const { template } of getSaveTemplates(slug)) {
    sources.push(...(await expandTemplate(template, baseDirectory)));
  }
  if (sources.length === 0) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const directory = path.join(
    getRecompilationSnapshotsDirectory(slug),
    `${stamp}-${safeName(label)}`
  );
  await fs.promises.mkdir(directory, { recursive: true });

  const items: { source: string; stored: string }[] = [];
  for (const [index, source] of sources.entries()) {
    const stored = `${index}-${safeName(path.basename(source))}`;
    await fs.promises.cp(source, path.join(directory, stored), {
      recursive: true,
    });
    items.push({ source, stored });
  }
  await fs.promises.writeFile(
    path.join(directory, MANIFEST_FILE),
    JSON.stringify(
      { createdAt: new Date().toISOString(), label, items },
      null,
      2
    )
  );

  const snapshots = await listSnapshots(slug);
  for (const old of snapshots.slice(0, -SNAPSHOTS_TO_KEEP)) {
    await fs.promises
      .rm(old, { recursive: true, force: true })
      .catch((error) => logger.warn("Failed to prune save snapshot", error));
  }
  return directory;
};

/**
 * Saves that live inside the install folder would otherwise go back in time
 * when the folder is swapped for the previous version.
 */
export const carryOverInFolderSaves = async (
  slug: string,
  fromBaseDirectory: string,
  toBaseDirectory: string
) => {
  for (const { template } of getSaveTemplates(slug)) {
    if (!template.startsWith("<base>")) continue;

    for (const source of await expandTemplate(template, fromBaseDirectory)) {
      const relative = path.relative(fromBaseDirectory, source);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;

      const target = path.join(toBaseDirectory, relative);
      await fs.promises.rm(target, { recursive: true, force: true });
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.cp(source, target, { recursive: true });
    }
  }
};
