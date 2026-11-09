import type { Game, PersonalCloudLinkInput } from "@types";

/** A slow connection never holds a game back for longer than this. */
export const PRE_LAUNCH_SYNC_TIMEOUT_MS = 60_000;

export interface PersonalCloudPlatform {
  platform: NodeJS.Platform;
  /** Hydra's Wine prefix for the game on Linux, the folder holding drive_c. */
  winePrefixPath: string | null;
}

const isWindowsExecutable = (executablePath: string) =>
  /\.exe$/i.test(executablePath);

/**
 * Works out how Cloud Save Manager should find a game's saves. Cloud Save
 * Manager syncs Windows games by their exe, so on Linux only games run through
 * Wine or Proton are linked, using Hydra's prefix in place of a Steam
 * compatdata folder.
 */
export const getPersonalCloudLinkInput = (
  game: Pick<Game, "executablePath" | "title" | "objectId">,
  { platform, winePrefixPath }: PersonalCloudPlatform
): PersonalCloudLinkInput | null => {
  const exePath = game.executablePath?.trim();
  if (!exePath) return null;
  const name = game.title?.trim() || game.objectId;

  // ROMs, scripts and shortcuts would match the wrong catalogue entry.
  if (!isWindowsExecutable(exePath)) return null;
  // Leave winePrefixPath out rather than null: napi rejects null for an
  // Option<String> field ("Failed to convert JavaScript value `Null`").
  if (platform === "win32") return { exePath, name };
  if (platform !== "linux" || !winePrefixPath) return null;
  return { exePath, name, winePrefixPath };
};
