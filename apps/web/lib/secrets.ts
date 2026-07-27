import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is required");

  if (/^[a-f\d]{64}$/i.test(raw)) return Buffer.from(raw, "hex");

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length === 32) return decoded;

  throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or base64");
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivValue, tagValue, encryptedValue] = payload.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Invalid encrypted secret payload");
  }

  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
