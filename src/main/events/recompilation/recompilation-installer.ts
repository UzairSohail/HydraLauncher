import { shell } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  isRecompilationAssetFromRepository,
  pickRecompilationInstallAsset,
} from "@shared";
import type {
  RecompilationActionResult,
  RecompilationDetails,
  RecompilationInstallProgress,
  RecompilationInstallState,
  RecompilationPrepareProgress,
  RecompilationRef,
  RecompilationReleases,
} from "@types";
import {
  HydraApi,
  logger,
  SevenZip,
  SystemPath,
  WindowManager,
} from "@main/services";
import {
  downloadToFile,
  removeFileQuietly,
} from "@main/services/download-to-file";
import {
  forgetRecompilationInstallDirectory,
  getPreviousVersionDirectory,
  getRecompilationBaseDirectory,
  getRecompilationInstallDirectory as getInstallDirectory,
  INSTALL_MARKER_FILE,
  type InstallMarker,
  parseRecompilationRef as parseRef,
  readInstallMarker,
  saveRecompilationInstallDirectory,
} from "./recompilation-paths";
import {
  getRecompilationExecutableOverride,
  markRecompilationRomLaunched,
  prepareRecompilationRom,
  shouldHideRecompilationConsole,
  shouldPrepareAfterUpdate,
} from "./recompilation-rom";
import recompilationSaves from "./recompilation-saves.json";
import {
  carryOverInFolderSaves,
  snapshotRecompilationSaves,
} from "./recompilation-save-snapshots";
import {
  addRecompilationDisc,
  removeRecompilationDisc,
} from "./recompilation-disc";
import {
  findDeclaredRecompilationEntry,
  findRecompilationExecutable,
  isBareReleaseExecutable,
  isNestedReleaseArchive,
  restoreExecutableBits,
} from "./recompilation-executable";

const MAX_NESTED_ARCHIVES = 3;

export class RecompilationInstallError extends Error {}

const installsInProgress = new Set<string>();
const launchesInProgress = new Set<string>();
const preparesInProgress = new Set<string>();

const sendProgress = (progress: RecompilationInstallProgress) => {
  WindowManager.mainWindow?.webContents.send(
    "on-recompilation-install-progress",
    progress
  );
};

const sendPrepareProgress = (progress: RecompilationPrepareProgress) => {
  if (progress.phase === "running") preparesInProgress.add(progress.slug);
  else preparesInProgress.delete(progress.slug);

  WindowManager.mainWindow?.webContents.send(
    "on-recompilation-prepare-progress",
    progress
  );
};

const apiPath = ({ objectId, slug }: RecompilationRef) =>
  `/games/launchbox/${objectId}/recompilations/${slug}`;

const loadSession = () => import("./recompilation-session");

const hashFile = (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

const isExecutableInUse = async (executablePath: string | null) => {
  if (!executablePath) return false;
  try {
    const handle = await fs.promises.open(executablePath, "r+");
    await handle.close();
    return false;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    return code === "EBUSY" || code === "ETXTBSY";
  }
};

const isPortRunning = async (
  ref: RecompilationRef,
  executablePath: string | null
) => {
  if (launchesInProgress.has(ref.slug)) return true;
  const { isRecompilationRunning } = await loadSession();
  return isRecompilationRunning(ref) || isExecutableInUse(executablePath);
};

const getSingleEntry = async (directory: string) => {
  const entries = await fs.promises.readdir(directory, {
    withFileTypes: true,
  });
  return entries.length === 1 ? entries[0] : null;
};

const refreshDeclaredEntry = async (
  slug: string,
  installDirectory: string,
  executablePath: string
) => {
  const declared = await findDeclaredRecompilationEntry(
    installDirectory,
    getRecompilationExecutableOverride(slug)
  ).catch(() => null);
  if (!declared || declared === executablePath) return executablePath;

  const marker = await readInstallMarker(installDirectory);
  if (marker) {
    await fs.promises.writeFile(
      path.join(installDirectory, INSTALL_MARKER_FILE),
      JSON.stringify({ ...marker, executablePath: declared }, null, 2)
    );
  }
  return declared;
};

const extractNestedArchives = async (stagingDirectory: string) => {
  for (let layer = 0; layer < MAX_NESTED_ARCHIVES; layer++) {
    const entry = await getSingleEntry(stagingDirectory);
    if (!entry?.isFile() || !isNestedReleaseArchive(entry.name)) return;

    const archivePath = path.join(stagingDirectory, entry.name);
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: stagingDirectory,
    });
    await fs.promises.rm(archivePath, { force: true });
  }
};

const resolveExtractedRoot = async (stagingDirectory: string) => {
  const entry = await getSingleEntry(stagingDirectory);
  return entry?.isDirectory()
    ? path.join(stagingDirectory, entry.name)
    : stagingDirectory;
};

const extractRelease = async (
  archivePath: string,
  assetName: string,
  installDirectory: string,
  portName: string,
  executableOverride: string | null
) => {
  const stagingDirectory = `${installDirectory}.partial`;
  await fs.promises.rm(stagingDirectory, { recursive: true, force: true });

  try {
    if (isBareReleaseExecutable(assetName, executableOverride)) {
      await fs.promises.mkdir(stagingDirectory, { recursive: true });
      await fs.promises.copyFile(
        archivePath,
        path.join(stagingDirectory, path.basename(assetName))
      );
    } else {
      await SevenZip.extractFile({
        filePath: archivePath,
        outputPath: stagingDirectory,
      });
    }
    await extractNestedArchives(stagingDirectory);
    const root = await resolveExtractedRoot(stagingDirectory);
    await restoreExecutableBits(root);
    const executablePath = await findRecompilationExecutable(
      root,
      portName,
      executableOverride
    );
    if (!executablePath) throw new RecompilationInstallError("no_executable");
    await fs.promises.mkdir(installDirectory, { recursive: true });
    await fs.promises.cp(root, installDirectory, {
      recursive: true,
      force: true,
      verbatimSymlinks: true,
    });
    return path.join(installDirectory, path.relative(root, executablePath));
  } finally {
    await fs.promises.rm(stagingDirectory, { recursive: true, force: true });
  }
};

export const getRecompilationInstallState = async (
  rawRef: unknown
): Promise<RecompilationInstallState | null> => {
  const ref = parseRef(rawRef);
  if (!ref) return null;

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  const installed = marker?.slug === ref.slug;

  return {
    installed,
    isInstalling: installsInProgress.has(ref.slug),
    isPreparing: preparesInProgress.has(ref.slug),
    version: installed ? marker.version : null,
    installPath: installed ? installDirectory : null,
    installParentPath: path.dirname(installDirectory),
    executablePath: installed ? marker.executablePath : null,
    hasCloudSaves: Object.hasOwn(recompilationSaves, ref.slug),
  };
};

const resolveTargetDirectory = async (
  ref: RecompilationRef,
  rawParentDirectory: unknown,
  isInstalled: boolean
) => {
  if (
    isInstalled ||
    typeof rawParentDirectory !== "string" ||
    !path.isAbsolute(rawParentDirectory)
  ) {
    return getInstallDirectory(ref.slug);
  }

  try {
    await fs.promises.mkdir(rawParentDirectory, { recursive: true });
    await fs.promises.access(rawParentDirectory, fs.constants.W_OK);
  } catch {
    throw new RecompilationInstallError("install_folder_unwritable");
  }
  return path.join(rawParentDirectory, ref.slug);
};

export interface ResolvedRecompilationRelease {
  version: string;
  publishedAt: string | null;
  sourceId: string;
  asset: {
    name: string;
    url: string;
    size: number | null;
    sha256: string | null;
  };
  /** Shown in the library; kept from the current install when omitted. */
  name?: string;
  iconUrl?: string | null;
}

export type RecompilationReleaseResolver = (
  ref: RecompilationRef
) => Promise<ResolvedRecompilationRelease>;

export const CATALOG_SOURCE_ID = "catalog";

const fetchRelease = async (ref: RecompilationRef) => {
  const [details, { releases }] = await Promise.all([
    HydraApi.get<RecompilationDetails>(apiPath(ref), undefined, {
      needsAuth: false,
    }),
    HydraApi.get<RecompilationReleases>(`${apiPath(ref)}/releases`, undefined, {
      needsAuth: false,
    }),
  ]);
  const release =
    releases.find((item) => item.isLatest) ?? releases.at(0) ?? null;
  const asset = release
    ? pickRecompilationInstallAsset(release.assets, process.platform)
    : null;

  if (
    !release ||
    !asset ||
    !isRecompilationAssetFromRepository(
      asset,
      details.repository.fullName,
      release.tag
    )
  ) {
    throw new RecompilationInstallError("no_release_file");
  }

  return { details, release, asset };
};

const resolveCatalogRelease: RecompilationReleaseResolver = async (ref) => {
  const { details, release, asset } = await fetchRelease(ref);
  return {
    version: release.version,
    publishedAt: release.publishedAt,
    sourceId: CATALOG_SOURCE_ID,
    asset,
    name: details.name,
    iconUrl: details.iconUrl,
  };
};

const isSafeDownloadUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

/** Keeps the installed files and saves so an update can be rolled back. */
const backUpBeforeUpdate = async (
  ref: RecompilationRef,
  installDirectory: string,
  version: string
) => {
  const baseDirectory = await getRecompilationBaseDirectory(installDirectory);
  try {
    await snapshotRecompilationSaves(
      ref.slug,
      baseDirectory,
      `before-${version}`
    );
  } catch (error) {
    logger.error(`Failed to back up saves for ${ref.slug}`, error);
    throw new RecompilationInstallError("save_backup_failed");
  }

  const previous = getPreviousVersionDirectory(installDirectory);
  const staging = `${previous}.partial`;
  try {
    await fs.promises.rm(staging, { recursive: true, force: true });
    await fs.promises.cp(installDirectory, staging, {
      recursive: true,
      verbatimSymlinks: true,
    });
    await fs.promises.rm(previous, { recursive: true, force: true });
    await fs.promises.rename(staging, previous);
  } catch (error) {
    logger.error(`Failed to keep the previous version of ${ref.slug}`, error);
    await fs.promises
      .rm(staging, { recursive: true, force: true })
      .catch(() => {});
    throw new RecompilationInstallError("previous_backup_failed");
  }
};

const downloadAndInstall = async (
  ref: RecompilationRef,
  installDirectory: string,
  onArchivePath: (archivePath: string) => void,
  resolveRelease: RecompilationReleaseResolver
) => {
  const resolved = await resolveRelease(ref);
  const { asset } = resolved;
  if (!isSafeDownloadUrl(asset.url)) {
    throw new RecompilationInstallError("no_release_file");
  }
  const current = await readInstallMarker(installDirectory);
  const portName = resolved.name ?? current?.name ?? ref.slug;
  const iconUrl = resolved.iconUrl ?? current?.iconUrl ?? null;

  const archivePath = path.join(
    SystemPath.getPath("temp"),
    `hydra-recompilation-${ref.slug}-${path.basename(asset.name)}`
  );
  onArchivePath(archivePath);

  sendProgress({
    slug: ref.slug,
    phase: "downloading",
    loaded: 0,
    total: asset.size ?? undefined,
  });

  await downloadToFile(asset.url, archivePath, (loaded, total) => {
    sendProgress({
      slug: ref.slug,
      phase: "downloading",
      loaded,
      total: total ?? asset.size ?? undefined,
    });
  });

  const { size } = await fs.promises.stat(archivePath);
  if (asset.size !== null && size !== asset.size) {
    throw new Error(`Unexpected size for ${asset.name}: ${size}`);
  }
  if (asset.sha256 && (await hashFile(archivePath)) !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.name}`);
  }

  sendProgress({ slug: ref.slug, phase: "extracting" });
  // After the download, so a failed download doesn't replace the kept version.
  if (current?.slug === ref.slug) {
    await backUpBeforeUpdate(ref, installDirectory, resolved.version);
  }
  const executablePath = await extractRelease(
    archivePath,
    asset.name,
    installDirectory,
    portName,
    getRecompilationExecutableOverride(ref.slug)
  );

  const marker: InstallMarker = {
    slug: ref.slug,
    objectId: ref.objectId,
    version: resolved.version,
    assetName: asset.name,
    executablePath,
    installedAt: new Date().toISOString(),
    name: portName,
    iconUrl,
    sourceId: resolved.sourceId,
    publishedAt: resolved.publishedAt,
  };
  await fs.promises.writeFile(
    path.join(installDirectory, INSTALL_MARKER_FILE),
    JSON.stringify(marker, null, 2)
  );
  await saveRecompilationInstallDirectory(ref.slug, installDirectory);
  await addRecompilationDisc(ref, installDirectory, {
    name: portName,
    iconUrl,
  });
};

export const installRecompilation = async (
  rawRef: unknown,
  rawParentDirectory?: unknown,
  resolveRelease: RecompilationReleaseResolver = resolveCatalogRelease
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  installsInProgress.add(ref.slug);

  let archivePath = null as string | null;
  let installDirectory = null as string | null;
  let preparing = false;
  let result: RecompilationActionResult;

  try {
    const current = await getRecompilationInstallState(ref);
    if (await isPortRunning(ref, current?.executablePath ?? null)) {
      return { ok: false, reason: "running" };
    }

    installDirectory = await resolveTargetDirectory(
      ref,
      rawParentDirectory,
      current?.installed === true
    );
    await downloadAndInstall(
      ref,
      installDirectory,
      (downloadPath) => {
        archivePath = downloadPath;
      },
      resolveRelease
    );
    result = { ok: true };
    preparing = await shouldPrepareAfterUpdate(ref).catch(() => false);
  } catch (error) {
    logger.error(`Failed to install recompilation ${ref.slug}`, error);
    result = {
      ok: false,
      reason:
        error instanceof RecompilationInstallError
          ? error.message
          : "install_failed",
    };
  } finally {
    if (archivePath) await removeFileQuietly(archivePath);
    // Hands the port straight to the preparation, so Play can't start in between.
    if (preparing) launchesInProgress.add(ref.slug);
    installsInProgress.delete(ref.slug);
  }

  sendProgress(
    result.ok
      ? { slug: ref.slug, phase: "done" }
      : { slug: ref.slug, phase: "error", reason: result.reason }
  );

  if (preparing && installDirectory) {
    void runPreparation(ref, installDirectory);
    return { ...result, preparing: true };
  }

  return result;
};

export const getRecompilationPreviousVersion = async (
  ref: RecompilationRef
) => {
  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(
    getPreviousVersionDirectory(installDirectory)
  );
  return marker?.slug === ref.slug ? marker.version : null;
};

/**
 * Swaps the install with the copy kept before the last update. The newer files
 * become the kept copy, so rolling back again returns to them.
 */
export const rollbackRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  const installDirectory = await getInstallDirectory(ref.slug);
  const previousDirectory = getPreviousVersionDirectory(installDirectory);
  const current = await readInstallMarker(installDirectory);
  const previous = await readInstallMarker(previousDirectory);
  if (current?.slug !== ref.slug) return { ok: false, reason: "not_installed" };
  if (previous?.slug !== ref.slug) return { ok: false, reason: "no_previous" };
  if (await isPortRunning(ref, current.executablePath)) {
    return { ok: false, reason: "running" };
  }

  installsInProgress.add(ref.slug);
  let preparing = false;
  try {
    const currentBase = await getRecompilationBaseDirectory(installDirectory);
    try {
      await snapshotRecompilationSaves(
        ref.slug,
        currentBase,
        `before-rollback-${current.version}`
      );
    } catch (error) {
      logger.error(`Failed to back up saves for ${ref.slug}`, error);
      return { ok: false, reason: "save_backup_failed" };
    }

    const swapDirectory = `${installDirectory}.rollback`;
    await fs.promises.rm(swapDirectory, { recursive: true, force: true });
    await fs.promises.rename(installDirectory, swapDirectory);
    try {
      await fs.promises.rename(previousDirectory, installDirectory);
    } catch (error) {
      await fs.promises.rename(swapDirectory, installDirectory);
      throw error;
    }
    await fs.promises.rename(swapDirectory, previousDirectory);

    const swappedBase = path.join(
      previousDirectory,
      path.relative(installDirectory, currentBase)
    );
    await carryOverInFolderSaves(
      ref.slug,
      swappedBase,
      await getRecompilationBaseDirectory(installDirectory)
    );

    await addRecompilationDisc(ref, installDirectory, {
      name: previous.name ?? current.name ?? ref.slug,
      iconUrl: previous.iconUrl ?? current.iconUrl ?? null,
    });
    preparing = await shouldPrepareAfterUpdate(ref).catch(() => false);
  } catch (error) {
    logger.error(`Failed to roll back ${ref.slug}`, error);
    return { ok: false, reason: "rollback_failed" };
  } finally {
    if (preparing) launchesInProgress.add(ref.slug);
    installsInProgress.delete(ref.slug);
  }

  if (preparing) {
    void runPreparation(ref, installDirectory);
    return { ok: true, preparing: true };
  }
  return { ok: true };
};

export const uninstallRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  const installDirectory = await getInstallDirectory(ref.slug);
  const marker = await readInstallMarker(installDirectory);
  if (marker?.slug !== ref.slug) {
    await removeRecompilationDisc(ref);
    return { ok: false, reason: "not_installed" };
  }

  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }
  if (await isPortRunning(ref, marker.executablePath)) {
    return { ok: false, reason: "running" };
  }

  try {
    await fs.promises.rm(installDirectory, { recursive: true, force: true });
    await fs.promises.rm(getPreviousVersionDirectory(installDirectory), {
      recursive: true,
      force: true,
    });
  } catch (error) {
    logger.error(`Failed to uninstall ${ref.slug}`, error);
    return { ok: false, reason: "uninstall_failed" };
  }
  await forgetRecompilationInstallDirectory(ref.slug);
  await removeRecompilationDisc(ref);
  return { ok: true };
};

export const openRecompilationFolder = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const state = await getRecompilationInstallState(rawRef);
  if (!state?.installPath) return { ok: false, reason: "not_installed" };

  const error = await shell.openPath(state.installPath);
  return error ? { ok: false, reason: error } : { ok: true };
};

// Set by Hydra's own AppImage; a port's AppRun would resolve its files inside Hydra instead of its own folder.
const HYDRA_APPIMAGE_ENV = ["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

const getPortEnv = (launchEnv: Record<string, string>) => {
  const env = { ...process.env, ...launchEnv };
  for (const key of HYDRA_APPIMAGE_ENV) delete env[key];
  return env;
};

const spawnPort = (
  executablePath: string,
  launch: { args: string[]; env: Record<string, string> }
) =>
  new Promise<
    | { ok: true; child: ReturnType<typeof spawn> }
    | { ok: false; error: unknown }
  >((resolve) => {
    const child = spawn(executablePath, launch.args, {
      cwd: path.dirname(executablePath),
      env: getPortEnv(launch.env),
      detached: true,
      stdio: "ignore",
      shell: false,
    });
    child.once("spawn", () => {
      child.unref();
      resolve({ ok: true, child });
    });
    child.once("error", (error) => resolve({ ok: false, error }));
  });

const HIDE_CONSOLE_SCRIPT = [
  'Add-Type -TypeDefinition \'using System; using System.Text; using System.Runtime.InteropServices; public static class HydraPortConsole { delegate bool EnumProc(IntPtr h, IntPtr l); [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l); [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n); [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c); public static int Hide(uint pid) { int hidden = 0; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid || !IsWindowVisible(h)) return true; var name = new StringBuilder(64); GetClassName(h, name, 64); if (name.ToString() == "ConsoleWindowClass") { ShowWindow(h, 0); hidden++; } return true; }, IntPtr.Zero); return hidden; } }\'',
  "$portId = [uint32][Console]::In.ReadLine()",
  "$deadline = (Get-Date).AddSeconds(20)",
  "while ((Get-Date) -lt $deadline) { if (-not (Get-Process -Id $portId -ErrorAction SilentlyContinue)) { break }; if ([HydraPortConsole]::Hide($portId) -gt 0) { $deadline = (Get-Date).AddSeconds(2) }; Start-Sleep -Milliseconds 50 }",
].join("; ");

const startConsoleHider = () => {
  if (process.platform !== "win32") return null;
  const hider = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", HIDE_CONSOLE_SCRIPT],
    { stdio: ["pipe", "ignore", "ignore"], windowsHide: true }
  );
  hider.once("error", (error) =>
    logger.error("Failed to start the port console hider", error)
  );
  return hider;
};

const launchRecompilation = async (
  ref: RecompilationRef
): Promise<RecompilationActionResult> => {
  const state = await getRecompilationInstallState(ref);
  if (!state?.installPath) return { ok: false, reason: "not_installed" };
  if (!state.executablePath) return { ok: false, reason: "no_executable" };

  const executablePath = await refreshDeclaredEntry(
    ref.slug,
    state.installPath,
    state.executablePath
  );
  const relative = path.relative(state.installPath, executablePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return { ok: false, reason: "no_executable" };
  }

  const {
    clearRecompilationCloudSaveGuard,
    isRecompilationRunning,
    prepareRecompilationCloudSave,
    startRecompilationSession,
  } = await loadSession();
  if (
    isRecompilationRunning(ref) ||
    (await isExecutableInUse(executablePath))
  ) {
    return { ok: false, reason: "already_running" };
  }

  let prepared = false;
  const launch = await prepareRecompilationRom(
    ref,
    state.installPath,
    (step) => {
      prepared = true;
      sendPrepareProgress({ slug: ref.slug, phase: "running", ...step });
    }
  );
  if (prepared) {
    sendPrepareProgress({
      slug: ref.slug,
      phase: launch.ok ? "done" : "error",
    });
  }
  if (!launch.ok) return { ok: false, reason: launch.reason };

  if (!(await prepareRecompilationCloudSave(ref))) {
    return { ok: false, reason: "cloud_save_conflict" };
  }

  const consoleHider = shouldHideRecompilationConsole(ref.slug)
    ? startConsoleHider()
    : null;
  const spawned = await spawnPort(executablePath, launch);
  if (spawned.ok && spawned.child.pid) {
    consoleHider?.stdin?.end(`${spawned.child.pid}\n`);
  } else {
    consoleHider?.kill();
  }
  if (!spawned.ok) {
    logger.error("Failed to launch recompilation", spawned.error);
    clearRecompilationCloudSaveGuard(ref);
    return { ok: false, reason: "launch_failed" };
  }

  void markRecompilationRomLaunched(state.installPath);
  void startRecompilationSession(ref, spawned.child);
  return { ok: true };
};

export const playRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "not_installed" };
  if (launchesInProgress.has(ref.slug)) return { ok: false, reason: "running" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  launchesInProgress.add(ref.slug);
  try {
    return await launchRecompilation(ref);
  } finally {
    launchesInProgress.delete(ref.slug);
  }
};

export const prepareRecompilation = async (
  rawRef: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };
  if (launchesInProgress.has(ref.slug)) return { ok: false, reason: "running" };
  if (installsInProgress.has(ref.slug)) {
    return { ok: false, reason: "already_installing" };
  }

  const state = await getRecompilationInstallState(ref);
  if (!state?.installPath) return { ok: false, reason: "not_installed" };

  return runPreparation(ref, state.installPath);
};

/** Marks the port busy before the first await, so callers can report it as preparing right away. */
const runPreparation = async (
  ref: RecompilationRef,
  installPath: string
): Promise<RecompilationActionResult> => {
  launchesInProgress.add(ref.slug);
  sendPrepareProgress({ slug: ref.slug, phase: "running" });
  try {
    const result = await prepareRecompilationRom(ref, installPath, (step) =>
      sendPrepareProgress({ slug: ref.slug, phase: "running", ...step })
    );
    sendPrepareProgress({
      slug: ref.slug,
      phase: result.ok ? "done" : "error",
    });
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  } catch (error) {
    logger.error(`Failed to prepare recompilation ${ref.slug}`, error);
    sendPrepareProgress({ slug: ref.slug, phase: "error" });
    return { ok: false, reason: "rom_prepare_failed" };
  } finally {
    launchesInProgress.delete(ref.slug);
  }
};
