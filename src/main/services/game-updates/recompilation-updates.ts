import crypto from "node:crypto";

import axios, { isAxiosError } from "axios";
import { Notification } from "electron";
import { t } from "i18next";

import type {
  AddUpdateSourceInput,
  RecompilationActionResult,
  RecompilationRef,
  RecompilationUpdateState,
  RecompilationUpdateSummary,
  UpdateChannel,
  UpdateProviderInfo,
  UpdateSourceActionResult,
  UpdateSourceConfig,
  UpdateSourceState,
} from "@types";
import {
  recompilationInstallsSublevel,
  recompilationUpdatesSublevel,
  type RecompilationUpdateRecord,
} from "@main/level";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import { LocalNotificationManager } from "@main/services/notifications/local-notifications";
import {
  CATALOG_SOURCE_ID,
  getRecompilationPreviousVersion,
  installRecompilation,
  RecompilationInstallError,
} from "@main/events/recompilation/recompilation-installer";
import {
  parseRecompilationRef,
  readInstallMarker,
} from "@main/events/recompilation/recompilation-paths";
import { countRecompilationSnapshots } from "@main/events/recompilation/recompilation-save-snapshots";

import { ProviderRegistry } from "./provider-registry";
import {
  HYDRA_CATALOG_PROVIDER_ID,
  registerBuiltInProviders,
  toCatalogLocator,
} from "./providers";
import {
  UpdateProviderError,
  type ProviderHttp,
  type UpdateProvider,
} from "./update-provider";
import {
  buildSourceState,
  emptyStatus,
  isCheckDue,
  pickBestSource,
  recordCheckFailure,
  recordCheckSuccess,
  selectInstallAsset,
  type InstalledPort,
} from "./update-state";

const REQUEST_TIMEOUT_MS = 15_000;
const FIRST_CHECK_DELAY_MS = 30_000;
const SCHEDULER_TICK_MS = 60 * 60 * 1000;
const MAX_SOURCES_PER_PORT = 10;

/** Every update provider, built-in or registered later through `register()`. */
export const updateProviders = new ProviderRegistry();
registerBuiltInProviders(updateProviders);

const http: ProviderHttp = {
  async getJson<T>(
    url: string,
    options: { headers?: Record<string, string>; signal?: AbortSignal } = {}
  ) {
    try {
      const response = await axios.get<T>(url, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: options.headers,
        signal: options.signal,
        responseType: "json",
      });
      return response.data;
    } catch (error) {
      if (isAxiosError(error) && error.response) {
        const { status } = error.response;
        if (status === 404) throw new UpdateProviderError("not_found");
        if (status === 403 || status === 429) {
          throw new UpdateProviderError("rate_limited");
        }
      }
      throw error;
    }
  },
};

const recordKey = (slug: string) => slug;

const catalogSource = (ref: RecompilationRef): UpdateSourceConfig => ({
  id: CATALOG_SOURCE_ID,
  providerId: HYDRA_CATALOG_PROVIDER_ID,
  locator: toCatalogLocator(ref.objectId, ref.slug),
  channel: "stable",
  assetFilter: null,
  addedAt: new Date(0).toISOString(),
});

const readRecord = async (
  ref: RecompilationRef
): Promise<RecompilationUpdateRecord> => {
  const record = await recompilationUpdatesSublevel
    .get(recordKey(ref.slug))
    .catch(() => undefined);
  return record ?? { ...ref, sources: [], statuses: {} };
};

const writeRecord = (record: RecompilationUpdateRecord) =>
  recompilationUpdatesSublevel.put(recordKey(record.slug), record);

const allSources = (
  ref: RecompilationRef,
  record: RecompilationUpdateRecord
) => [catalogSource(ref), ...record.sources];

interface InstalledInfo extends InstalledPort {
  ref: RecompilationRef;
  name: string;
}

const listInstalledPorts = async () => {
  const ports: InstalledInfo[] = [];
  for await (const [
    slug,
    directory,
  ] of recompilationInstallsSublevel.iterator()) {
    const marker = await readInstallMarker(directory);
    if (marker?.slug !== slug) continue;
    ports.push({
      ref: { objectId: marker.objectId, slug },
      name: marker.name ?? slug,
      version: marker.version,
      installedAt: marker.installedAt,
      sourceId: marker.sourceId ?? CATALOG_SOURCE_ID,
      assetName: marker.assetName,
    });
  }
  return ports;
};

const getInstalledPort = async (ref: RecompilationRef) =>
  (await listInstalledPorts()).find(
    (port) => port.ref.slug === ref.slug && port.ref.objectId === ref.objectId
  ) ?? null;

const describeError = (error: unknown) => {
  if (error instanceof UpdateProviderError) return error.message;
  if (isAxiosError(error)) return error.code ?? "network_error";
  return "check_failed";
};

const buildStates = (
  ref: RecompilationRef,
  record: RecompilationUpdateRecord,
  installed: InstalledPort
): UpdateSourceState[] =>
  allSources(ref, record).map((config) =>
    buildSourceState(
      config,
      record.statuses[config.id] ?? emptyStatus(),
      updateProviders.get(config.providerId),
      installed,
      process.platform,
      process.arch
    )
  );

const broadcastChange = () =>
  WindowManager.sendToAppWindows("on-recompilation-updates-changed");

const notifyUpdate = async (port: InstalledInfo, version: string) => {
  const title = t("recompilation_update_available", {
    ns: "notifications",
    title: port.name,
  });
  const body = t("recompilation_update_version", {
    ns: "notifications",
    version,
  });
  const url = `/recompilation/${encodeURIComponent(port.ref.objectId)}/${encodeURIComponent(port.ref.slug)}`;

  if (Notification.isSupported()) {
    new Notification({ title, body })
      .on("click", () => WindowManager.focusMainWindowAndNavigate(url))
      .show();
  }
  await LocalNotificationManager.createNotification(
    "UPDATE_AVAILABLE",
    title,
    body,
    { url }
  );
};

const checkPort = async (port: InstalledInfo, force: boolean) => {
  const record = await readRecord(port.ref);
  const now = Date.now();
  let changed = false;

  for (const config of allSources(port.ref, record)) {
    const provider = updateProviders.get(config.providerId);
    if (!provider) continue;

    const status = record.statuses[config.id] ?? emptyStatus();
    if (!force && !isCheckDue(status, now)) continue;

    try {
      const latest = await provider.fetchLatest(config.locator, {
        channel: config.channel,
        http,
      });
      record.statuses[config.id] = recordCheckSuccess(status, latest, now);
    } catch (error) {
      logger.warn(`Update check failed for ${port.ref.slug} (${config.id})`, {
        provider: config.providerId,
        error: describeError(error),
      });
      record.statuses[config.id] = recordCheckFailure(
        status,
        describeError(error),
        now
      );
    }
    changed = true;
  }
  if (!changed) return false;

  const best = pickBestSource(
    buildStates(port.ref, record, port),
    port.sourceId
  );
  const bestVersion = best?.status.latest?.version ?? null;
  if (
    best &&
    bestVersion &&
    record.statuses[best.id].notifiedVersion !== bestVersion
  ) {
    record.statuses[best.id] = {
      ...record.statuses[best.id],
      notifiedVersion: bestVersion,
    };
    await notifyUpdate(port, bestVersion).catch((error) =>
      logger.warn("Failed to show update notification", error)
    );
  }

  await writeRecord(record);
  return true;
};

let checkPromise: Promise<void> | null = null;

/** Checks every installed port; only sources that are due unless forced. */
export const checkRecompilationUpdates = (force = false): Promise<void> => {
  checkPromise ??= (async () => {
    let changed = false;
    for (const port of await listInstalledPorts()) {
      changed = (await checkPort(port, force).catch(() => false)) || changed;
    }
    if (changed) broadcastChange();
  })().finally(() => {
    checkPromise = null;
  });
  return checkPromise;
};

export const checkRecompilationUpdatesFor = async (rawRef: unknown) => {
  const ref = parseRecompilationRef(rawRef);
  const port = ref ? await getInstalledPort(ref) : null;
  if (!port) return getRecompilationUpdateState(rawRef);

  await checkPort(port, true);
  broadcastChange();
  return getRecompilationUpdateState(ref);
};

export const getRecompilationUpdateState = async (
  rawRef: unknown
): Promise<RecompilationUpdateState | null> => {
  const ref = parseRecompilationRef(rawRef);
  if (!ref) return null;

  const record = await readRecord(ref);
  const port = await getInstalledPort(ref);
  const installed: InstalledPort = port ?? {
    version: null,
    installedAt: null,
    sourceId: null,
    assetName: null,
  };
  const sources = buildStates(ref, record, installed);

  return {
    objectId: ref.objectId,
    slug: ref.slug,
    name: port?.name ?? ref.slug,
    installedVersion: installed.version,
    installedSourceId: installed.sourceId,
    sources,
    bestSourceId: pickBestSource(sources, installed.sourceId)?.id ?? null,
    previousVersion: port ? await getRecompilationPreviousVersion(ref) : null,
    saveSnapshotCount: await countRecompilationSnapshots(ref.slug),
  };
};

export const getRecompilationUpdateSummaries = async (): Promise<
  RecompilationUpdateSummary[]
> => {
  const summaries: RecompilationUpdateSummary[] = [];
  for (const port of await listInstalledPorts()) {
    const record = await readRecord(port.ref);
    const best = pickBestSource(
      buildStates(port.ref, record, port),
      port.sourceId
    );
    if (!best?.status.latest) continue;
    summaries.push({
      objectId: port.ref.objectId,
      slug: port.ref.slug,
      name: port.name,
      installedVersion: port.version,
      latestVersion: best.status.latest.version,
      sourceId: best.id,
    });
  }
  return summaries;
};

const isChannel = (value: unknown): value is UpdateChannel =>
  value === "stable" || value === "prerelease";

const normalizeFilter = (value: unknown) =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim().slice(0, 200)
    : null;

export const addRecompilationUpdateSource = async (
  rawRef: unknown,
  input: AddUpdateSourceInput
): Promise<UpdateSourceActionResult> => {
  const ref = parseRecompilationRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  const provider = updateProviders.get(String(input?.providerId ?? ""));
  if (!provider || provider.isImplicit) {
    return { ok: false, reason: "unknown_provider" };
  }
  const locator =
    typeof input.input === "string" ? provider.parseInput(input.input) : null;
  if (!locator) return { ok: false, reason: "invalid_source" };

  const record = await readRecord(ref);
  if (record.sources.length >= MAX_SOURCES_PER_PORT) {
    return { ok: false, reason: "too_many_sources" };
  }
  const channel =
    provider.supportsChannels && isChannel(input.channel)
      ? input.channel
      : "stable";
  if (
    record.sources.some(
      (source) =>
        source.providerId === provider.id &&
        source.locator === locator &&
        source.channel === channel
    )
  ) {
    return { ok: false, reason: "duplicate_source" };
  }

  const source: UpdateSourceConfig = {
    id: crypto.randomBytes(6).toString("hex"),
    providerId: provider.id,
    locator,
    channel,
    assetFilter: provider.supportsDownloads
      ? normalizeFilter(input.assetFilter)
      : null,
    addedAt: new Date().toISOString(),
  };
  record.sources.push(source);
  await writeRecord(record);

  const port = await getInstalledPort(ref);
  if (port) await checkPort(port, false).catch(() => false);
  broadcastChange();
  return { ok: true };
};

export const updateRecompilationUpdateSource = async (
  rawRef: unknown,
  sourceId: unknown,
  patch: { channel?: unknown; assetFilter?: unknown }
): Promise<UpdateSourceActionResult> => {
  const ref = parseRecompilationRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  const record = await readRecord(ref);
  const source = record.sources.find((item) => item.id === sourceId);
  if (!source) return { ok: false, reason: "unknown_source" };

  const provider = updateProviders.get(source.providerId);
  if (isChannel(patch.channel) && provider?.supportsChannels) {
    if (patch.channel !== source.channel) {
      source.channel = patch.channel;
      record.statuses[source.id] = emptyStatus();
    }
  }
  if (patch.assetFilter !== undefined) {
    source.assetFilter = normalizeFilter(patch.assetFilter);
  }
  await writeRecord(record);

  const port = await getInstalledPort(ref);
  if (port) await checkPort(port, false).catch(() => false);
  broadcastChange();
  return { ok: true };
};

export const removeRecompilationUpdateSource = async (
  rawRef: unknown,
  sourceId: unknown
): Promise<UpdateSourceActionResult> => {
  const ref = parseRecompilationRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  const record = await readRecord(ref);
  const sources = record.sources.filter((source) => source.id !== sourceId);
  if (sources.length === record.sources.length) {
    return { ok: false, reason: "unknown_source" };
  }
  record.sources = sources;
  delete record.statuses[String(sourceId)];
  await writeRecord(record);
  broadcastChange();
  return { ok: true };
};

class NoDownloadError extends RecompilationInstallError {}

/** Installs the latest release of one source, checking it again first. */
export const installRecompilationFromSource = async (
  rawRef: unknown,
  sourceId: unknown
): Promise<RecompilationActionResult> => {
  const ref = parseRecompilationRef(rawRef);
  if (!ref) return { ok: false, reason: "invalid_port" };

  if (sourceId === CATALOG_SOURCE_ID) {
    const result = await installRecompilation(ref);
    void checkRecompilationUpdatesFor(ref).catch(() => undefined);
    return result;
  }

  const record = await readRecord(ref);
  const config = record.sources.find((source) => source.id === sourceId);
  const provider: UpdateProvider | null = config
    ? updateProviders.get(config.providerId)
    : null;
  if (!config || !provider) return { ok: false, reason: "unknown_source" };

  const port = await getInstalledPort(ref);
  const installed: InstalledPort = port ?? {
    version: null,
    installedAt: null,
    sourceId: null,
    assetName: null,
  };

  const result = await installRecompilation(ref, undefined, async () => {
    const latest = await provider.fetchLatest(config.locator, {
      channel: config.channel,
      http,
    });
    const asset = selectInstallAsset(
      provider,
      latest,
      config,
      installed,
      process.platform,
      process.arch
    );
    if (!latest || !asset) throw new NoDownloadError("no_release_file");
    return {
      version: latest.version,
      publishedAt: latest.publishedAt,
      sourceId: config.id,
      asset,
    };
  });

  void checkRecompilationUpdatesFor(ref).catch(() => undefined);
  return result;
};

export const getUpdateProviders = (): UpdateProviderInfo[] =>
  updateProviders.describe();

let schedulerTimer: NodeJS.Timeout | null = null;

export const startRecompilationUpdateScheduler = () => {
  if (schedulerTimer) return;

  const tick = () =>
    void checkRecompilationUpdates().catch((error) =>
      logger.warn("Recompilation update check failed", error)
    );

  setTimeout(tick, FIRST_CHECK_DELAY_MS).unref();
  schedulerTimer = setInterval(tick, SCHEDULER_TICK_MS);
  schedulerTimer.unref();

  // A provider registered later may be able to check sources that had none.
  updateProviders.onChange(() => {
    WindowManager.sendToAppWindows("on-update-providers-changed");
    broadcastChange();
    tick();
  });
};
