import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for the credentials section of the synced settings file. The
 * key is a random 32-byte key shared between devices through Drive.
 */

export interface SealedBox {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;

export const generateSyncKey = () => randomBytes(KEY_BYTES);

const assertKey = (key: Buffer) => {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Settings sync key must be ${KEY_BYTES} bytes`);
  }
};

export const sealJson = (key: Buffer, value: unknown): SealedBox => {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);

  return {
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
};

export const openJson = <T>(key: Buffer, box: SealedBox): T => {
  assertKey(key);
  if (box.v !== 1) throw new Error(`Unknown sealed box version ${box.v}`);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(box.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(box.data, "base64")),
    decipher.final(),
  ]);

  return JSON.parse(plain.toString("utf8")) as T;
};
