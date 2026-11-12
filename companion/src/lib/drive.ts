import { ROOT_FOLDER } from "./config";
import { forgetAccessToken, getAccessToken } from "./google";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

export class DriveError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

const quoted = (text: string) =>
  `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** Calls Drive with the signed-in account, trying once more with a fresh token on a 401. */
const request = async (url: string, init: RequestInit = {}, retry = true) => {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 && retry) {
    await forgetAccessToken(token);
    return request(url, init, false);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let message = `Google Drive returned ${response.status}`;
    try {
      message = JSON.parse(body)?.error?.message ?? message;
    } catch {
      // Not JSON; keep the status.
    }
    throw new DriveError(message, response.status);
  }
  return response;
};

const search = async (q: string, fields = "id,name,modifiedTime") => {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q,
      fields: `nextPageToken,files(${fields})`,
      orderBy: "createdTime",
      pageSize: "1000",
      spaces: "drive",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const reply = await (await request(`${API}/files?${params}`)).json();
    files.push(...(reply.files ?? []));
    pageToken = reply.nextPageToken;
  } while (pageToken);
  return files;
};

const folders = new Map<string, string>();

/**
 * The ID of a folder inside the launcher's Drive folder, such as "hydra" or
 * "hydra/devices". Found the same way the launcher finds it: oldest first.
 */
export const folderId = async (
  path: string,
  create = false
): Promise<string | null> => {
  const cached = folders.get(path);
  if (cached) return cached;

  const slash = path.lastIndexOf("/");
  const name = path === "" ? ROOT_FOLDER : path.slice(slash + 1);
  let parent: string | null = null;
  if (path !== "") {
    parent = await folderId(slash === -1 ? "" : path.slice(0, slash), create);
    if (!parent) return null;
  }

  let q = `name = ${quoted(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`;
  if (parent) q += ` and ${quoted(parent)} in parents`;
  let id = (await search(q, "id"))[0]?.id ?? null;

  if (!id && create) {
    const reply = await (
      await request(`${API}/files?fields=id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          mimeType: FOLDER_MIME,
          ...(parent ? { parents: [parent] } : {}),
        }),
      })
    ).json();
    id = reply.id;
  }
  if (id) folders.set(path, id);
  return id;
};

export const listFiles = async (folderPath: string) => {
  const folder = await folderId(folderPath);
  if (!folder) return [];
  return search(
    `${quoted(folder)} in parents and trashed = false and mimeType != '${FOLDER_MIME}'`
  );
};

const findFile = async (key: string) => {
  const slash = key.lastIndexOf("/");
  const files = await listFiles(key.slice(0, slash));
  return files.find((file) => file.name === key.slice(slash + 1)) ?? null;
};

export const readFileById = async (id: string) =>
  (await request(`${API}/files/${id}?alt=media`)).text();

/** Reads a file by its key, like `hydra/companion.json`. Null when missing. */
export const readFile = async (key: string) => {
  const file = await findFile(key);
  return file ? readFileById(file.id) : null;
};

/** Writes a file by its key, creating it and its folders when needed. */
export const writeFile = async (key: string, text: string) => {
  const file = await findFile(key);
  if (file) {
    await request(`${UPLOAD}/files/${file.id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: text,
    });
    return;
  }

  const slash = key.lastIndexOf("/");
  const parent = await folderId(key.slice(0, slash), true);
  const boundary = `nacho${Date.now().toString(16)}`;
  const metadata = JSON.stringify({
    name: key.slice(slash + 1),
    parents: [parent],
  });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${text}\r\n--${boundary}--\r\n`;
  await request(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
};

/** Moves a file to the bin, as the launcher does, so mistakes can be undone. */
export const trashFile = async (key: string) => {
  const file = await findFile(key);
  if (!file) return;
  await request(`${API}/files/${file.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
};
