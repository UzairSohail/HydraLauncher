import {
  COMPANION_FILE,
  companionDeviceFile,
  parseCompanionDeviceDocument,
  parseCompanionDocument,
  type CompanionDeviceDocument,
  type CompanionDocument,
  type CompanionRequest,
} from "../../../src/shared/companion";
import { listFiles, readFile, readFileById, trashFile, writeFile } from "./drive";

const DEVICES_FOLDER = "hydra/devices";

const emptyCompanion = (): CompanionDocument => ({
  version: 1,
  requests: [],
  devices: [],
});

/** Every launcher signed in to this Google account, most recently seen first. */
export const loadDevices = async (): Promise<CompanionDeviceDocument[]> => {
  const files = (await listFiles(DEVICES_FOLDER)).filter((file) =>
    file.name.endsWith(".json")
  );
  const devices = await Promise.all(
    files.map(async (file) => {
      try {
        return parseCompanionDeviceDocument(await readFileById(file.id));
      } catch {
        return null;
      }
    })
  );
  return devices
    .filter((device): device is CompanionDeviceDocument => device !== null)
    .sort((a, b) => b.lastSeen - a.lastSeen);
};

export const loadCompanion = async (): Promise<CompanionDocument> => {
  const text = await readFile(COMPANION_FILE);
  if (!text) return emptyCompanion();
  try {
    return parseCompanionDocument(text);
  } catch {
    return emptyCompanion();
  }
};

/**
 * Changes the phone's file from its latest copy in Drive. The phone is its
 * only writer, so reading first only guards against two phones.
 */
const updateCompanion = async (
  change: (document: CompanionDocument) => CompanionDocument,
  deviceIds: string[]
) => {
  const next = change(await loadCompanion());
  next.devices = deviceIds;
  await writeFile(COMPANION_FILE, JSON.stringify(next));
  return next;
};

const newId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const queueDownload = (
  request: Omit<CompanionRequest, "id" | "createdAt">,
  deviceIds: string[]
) =>
  updateCompanion(
    (document) => ({
      ...document,
      requests: [
        ...document.requests,
        { ...request, id: newId(), createdAt: Date.now() },
      ],
    }),
    deviceIds
  );

/** Removes requests, which also keeps the file small. */
export const removeRequests = (ids: string[], deviceIds: string[]) =>
  updateCompanion(
    (document) => ({
      ...document,
      requests: document.requests.filter((request) => !ids.includes(request.id)),
    }),
    deviceIds
  );

/** Forgets a launcher that's no longer used. Its file goes to the Drive bin. */
export const forgetDevice = async (deviceId: string, deviceIds: string[]) => {
  await trashFile(companionDeviceFile(deviceId));
  const remaining = deviceIds.filter((id) => id !== deviceId);
  await updateCompanion(
    (document) => ({
      ...document,
      requests: document.requests.filter(
        (request) => request.target !== deviceId
      ),
    }),
    remaining
  );
};
