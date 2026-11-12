/**
 * The files the Nacho phone app and the launchers share in Google Drive.
 * Kept free of imports so the phone app can use this file as it is.
 *
 * Each file has exactly one writer, so nobody overwrites anybody:
 * - `hydra/companion.json`: written by the phone. The download requests.
 * - `hydra/devices/<deviceId>.json`: written by that launcher. Its name, free
 *   space, a short library list and what it did with each request.
 *
 * Storage is kept small on purpose: no images, no catalogue data (both come
 * from the catalogue API), and requests are removed by the phone once done.
 */

export const COMPANION_FILE = "hydra/companion.json";
export const companionDeviceFile = (deviceId: string) =>
  `hydra/devices/${deviceId}.json`;

/** Sent as a request's target to let the first launcher that opens take it. */
export const ANY_DEVICE = "any";

export type CompanionShop = string;

/** The download listing picked on the phone, as the catalogue API returned it. */
export interface CompanionRepack {
  id: string;
  title: string;
  fileSize: string | null;
  uris: string[];
  uriGroups?: string[][];
  unavailableUris?: string[];
  uploadDate: string | null;
  downloadSourceId: string;
  downloadSourceName: string;
  createdAt: string;
}

export interface CompanionRequest {
  id: string;
  createdAt: number;
  /** A device id, or `ANY_DEVICE`. */
  target: string;
  shop: CompanionShop;
  objectId: string;
  title: string;
  repack: CompanionRepack;
}

/** Written by the phone. */
export interface CompanionDocument {
  version: 1;
  requests: CompanionRequest[];
  /** Device ids the phone knows about, so launchers can settle "any" requests. */
  devices: string[];
}

export type CompanionRequestState =
  /** Taken from an "any" request; downloads once no other launcher took it first. */
  | "claimed"
  | "queued"
  | "downloading"
  | "done"
  | "failed"
  /** The download was cancelled on the computer. */
  | "cancelled"
  /** An "any" request another launcher took first. */
  | "skipped";

export interface CompanionRequestStatus {
  state: CompanionRequestState;
  /** When the state last changed. */
  at: number;
  /** 0 to 1, while queued or downloading. */
  progress?: number;
  error?: string;
}

/** One library entry; fields at their default are left out to save space. */
export interface CompanionLibraryGame {
  shop: CompanionShop;
  objectId: string;
  title: string;
  installed?: true;
  /** Minutes played. */
  minutes?: number;
  /** When it was last played, in ms. */
  lastPlayed?: number;
}

/** Written by each launcher. */
export interface CompanionDeviceDocument {
  version: 1;
  id: string;
  name: string;
  platform: string;
  appVersion: string;
  lastSeen: number;
  /** Whether this launcher takes requests from the phone. */
  acceptsRequests: boolean;
  downloadPath: string;
  freeBytes: number | null;
  /** The download sources this launcher has, with the ids the catalogue API knows. */
  sources: { id: string; name: string }[];
  library: CompanionLibraryGame[];
  requests: Record<string, CompanionRequestStatus>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const parseRepack = (value: unknown): CompanionRepack | null => {
  if (!isObject(value)) return null;
  const { id, title, uris, downloadSourceId } = value;
  if (!isString(id) || !isString(title) || !isString(downloadSourceId)) {
    return null;
  }
  if (!Array.isArray(uris) || !uris.every(isString) || uris.length === 0) {
    return null;
  }
  const uriGroups = Array.isArray(value.uriGroups)
    ? value.uriGroups.filter(
        (group): group is string[] =>
          Array.isArray(group) && group.every(isString)
      )
    : undefined;
  const unavailableUris = Array.isArray(value.unavailableUris)
    ? value.unavailableUris.filter(isString)
    : undefined;
  return {
    id,
    title,
    fileSize: isString(value.fileSize) ? value.fileSize : null,
    uris,
    uriGroups,
    unavailableUris,
    uploadDate: isString(value.uploadDate) ? value.uploadDate : null,
    downloadSourceId,
    downloadSourceName: isString(value.downloadSourceName)
      ? value.downloadSourceName
      : "",
    createdAt: isString(value.createdAt) ? value.createdAt : "",
  };
};

const parseRequest = (value: unknown): CompanionRequest | null => {
  if (!isObject(value)) return null;
  const { id, target, shop, objectId, title, createdAt } = value;
  if (
    !isString(id) ||
    !isString(target) ||
    !isString(shop) ||
    !isString(objectId) ||
    !isString(title)
  ) {
    return null;
  }
  const repack = parseRepack(value.repack);
  if (!repack) return null;
  return {
    id,
    target,
    shop,
    objectId,
    title,
    createdAt: typeof createdAt === "number" ? createdAt : 0,
    repack,
  };
};

/** Reads the phone's file, dropping any request it can't make sense of. */
export const parseCompanionDocument = (text: string): CompanionDocument => {
  const value: unknown = JSON.parse(text);
  if (!isObject(value)) throw new Error("Not a companion file");
  const requests = Array.isArray(value.requests)
    ? value.requests
        .map(parseRequest)
        .filter((request): request is CompanionRequest => request !== null)
    : [];
  const devices = Array.isArray(value.devices)
    ? value.devices.filter(isString)
    : [];
  return { version: 1, requests, devices };
};

const parseStatus = (value: unknown): CompanionRequestStatus | null => {
  if (!isObject(value) || !isString(value.state)) return null;
  return {
    state: value.state as CompanionRequestState,
    at: typeof value.at === "number" ? value.at : 0,
    progress: typeof value.progress === "number" ? value.progress : undefined,
    error: isString(value.error) ? value.error : undefined,
  };
};

/** Reads a launcher's file. Only what other launchers and the phone rely on is checked. */
export const parseCompanionDeviceDocument = (
  text: string
): CompanionDeviceDocument => {
  const value: unknown = JSON.parse(text);
  if (!isObject(value) || !isString(value.id)) {
    throw new Error("Not a device file");
  }
  const requests: Record<string, CompanionRequestStatus> = {};
  if (isObject(value.requests)) {
    for (const [id, raw] of Object.entries(value.requests)) {
      const status = parseStatus(raw);
      if (status) requests[id] = status;
    }
  }
  return {
    version: 1,
    id: value.id,
    name: isString(value.name) ? value.name : value.id,
    platform: isString(value.platform) ? value.platform : "",
    appVersion: isString(value.appVersion) ? value.appVersion : "",
    lastSeen: typeof value.lastSeen === "number" ? value.lastSeen : 0,
    acceptsRequests: value.acceptsRequests !== false,
    downloadPath: isString(value.downloadPath) ? value.downloadPath : "",
    freeBytes: typeof value.freeBytes === "number" ? value.freeBytes : null,
    sources: Array.isArray(value.sources)
      ? value.sources.filter(
          (source): source is { id: string; name: string } =>
            isObject(source) && isString(source.id) && isString(source.name)
        )
      : [],
    library: Array.isArray(value.library)
      ? (value.library.filter(
          (game) =>
            isObject(game) &&
            isString(game.shop) &&
            isString(game.objectId) &&
            isString(game.title)
        ) as CompanionLibraryGame[])
      : [],
    requests,
  };
};

/** States in which a launcher is taking care of a request, or already did. */
const ACTIVE_STATES: CompanionRequestState[] = [
  "claimed",
  "queued",
  "downloading",
  "done",
];

/**
 * Settles who downloads an "any" request: the earliest claim wins, and the
 * lower device id breaks a tie. Returns the winning device id, or null when
 * nobody claimed it.
 */
export const resolveAnyClaim = (
  requestId: string,
  devices: Pick<CompanionDeviceDocument, "id" | "requests">[]
): string | null => {
  let winner: { id: string; at: number } | null = null;
  for (const device of devices) {
    const status = device.requests[requestId];
    if (!status || !ACTIVE_STATES.includes(status.state)) continue;
    if (
      !winner ||
      status.at < winner.at ||
      (status.at === winner.at && device.id < winner.id)
    ) {
      winner = { id: device.id, at: status.at };
    }
  }
  return winner?.id ?? null;
};

/** Whether a request is finished from the phone's point of view. */
export const isFinishedRequestState = (state: CompanionRequestState) =>
  state === "done" ||
  state === "failed" ||
  state === "cancelled" ||
  state === "skipped";
