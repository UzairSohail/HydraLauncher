import fs from "node:fs";
import path from "node:path";

/**
 * Nacho used to keep its data in the folder Hydra used (`hydralauncher`).
 * This moves it to `nacho-launcher` once, without ever starting empty:
 *
 * - The old folder is renamed, not copied. Both live in the same parent
 *   folder, so the rename is instant, atomic and needs no extra disk space
 *   (wine prefixes alone can be many GB).
 * - A link is left at the old path (a symlink on Linux/macOS, a junction on
 *   Windows) so absolute paths already saved in the database, Steam
 *   shortcuts and desktop shortcuts keep resolving.
 * - If anything fails, Nacho keeps using the old folder for this launch and
 *   tries again next time.
 *
 * Pure (no Electron imports) so it can be unit tested.
 */

export const LEGACY_USER_DATA_FOLDER = "hydralauncher";
export const USER_DATA_FOLDER = "nacho-launcher";
export const MIGRATION_MARKER_FILE = ".migrated-from-hydralauncher";

// Only treat a folder as holding real data if it has the library database.
const DATA_MARKERS = ["hydra-db", "hydra-db-staging"];

export interface UserDataMigrationResult {
  userDataPath: string;
  messages: string[];
}

type FsLike = Pick<
  typeof fs,
  | "lstatSync"
  | "existsSync"
  | "renameSync"
  | "symlinkSync"
  | "writeFileSync"
  | "readdirSync"
  | "rmdirSync"
>;

const lstatOrNull = (fsImpl: FsLike, target: string) => {
  try {
    return fsImpl.lstatSync(target);
  } catch {
    return null;
  }
};

const hasUserData = (fsImpl: FsLike, folder: string) =>
  DATA_MARKERS.some((marker) => fsImpl.existsSync(path.join(folder, marker)));

const linkLegacyFolder = (
  fsImpl: FsLike,
  legacyPath: string,
  newPath: string,
  platform: NodeJS.Platform,
  messages: string[]
) => {
  try {
    fsImpl.symlinkSync(
      newPath,
      legacyPath,
      platform === "win32" ? "junction" : "dir"
    );
    messages.push(`Linked old data folder ${legacyPath} -> ${newPath}`);
  } catch (error) {
    messages.push(
      `Could not link old data folder ${legacyPath} (${String(error)}); older saved paths may need re-linking`
    );
  }
};

/**
 * Electron creates the default (old-named) folder, empty, before any of our
 * code runs. Remove it again so fresh installs only ever show the new name.
 * rmdir refuses non-empty folders, so this can never delete data.
 */
const removeIfEmpty = (fsImpl: FsLike, folder: string) => {
  try {
    if (fsImpl.readdirSync(folder).length > 0) return false;
    fsImpl.rmdirSync(folder);
    return true;
  } catch {
    return false;
  }
};

export const migrateUserDataFolder = ({
  legacyPath,
  newPath,
  platform = process.platform,
  fsImpl = fs,
}: {
  legacyPath: string;
  newPath: string;
  platform?: NodeJS.Platform;
  fsImpl?: FsLike;
}): UserDataMigrationResult => {
  const messages: string[] = [];
  let legacyStat = lstatOrNull(fsImpl, legacyPath);
  if (
    legacyStat?.isDirectory() &&
    !legacyStat.isSymbolicLink() &&
    removeIfEmpty(fsImpl, legacyPath)
  ) {
    legacyStat = null;
  }

  const newStat = lstatOrNull(fsImpl, newPath);
  const legacyIsRealFolder =
    !!legacyStat && legacyStat.isDirectory() && !legacyStat.isSymbolicLink();

  if (newStat) {
    if (legacyIsRealFolder && !hasUserData(fsImpl, newPath)) {
      // Both exist but the new one has no library: never switch to an
      // empty folder over a real one.
      if (hasUserData(fsImpl, legacyPath)) {
        messages.push(
          `Both ${legacyPath} and ${newPath} exist and only the old one has data; using the old folder`
        );
        return { userDataPath: legacyPath, messages };
      }
    }

    // Re-create the compatibility link if we migrated earlier but the link
    // went missing (e.g. it failed to be created last time).
    if (
      !legacyStat &&
      fsImpl.existsSync(path.join(newPath, MIGRATION_MARKER_FILE))
    ) {
      linkLegacyFolder(fsImpl, legacyPath, newPath, platform, messages);
    }

    return { userDataPath: newPath, messages };
  }

  if (!legacyIsRealFolder) {
    // Fresh install (or the old path is already just a link): start in the
    // new folder and never create the old name.
    return { userDataPath: newPath, messages };
  }

  try {
    fsImpl.renameSync(legacyPath, newPath);
  } catch (error) {
    messages.push(
      `Could not move ${legacyPath} to ${newPath} (${String(error)}); keeping the old data folder for now and retrying next launch`
    );
    return { userDataPath: legacyPath, messages };
  }

  messages.push(`Moved data folder ${legacyPath} -> ${newPath}`);

  try {
    fsImpl.writeFileSync(
      path.join(newPath, MIGRATION_MARKER_FILE),
      `${legacyPath}\n`
    );
  } catch {
    // Marker is only used to restore a missing link later; not critical.
  }

  linkLegacyFolder(fsImpl, legacyPath, newPath, platform, messages);

  return { userDataPath: newPath, messages };
};
