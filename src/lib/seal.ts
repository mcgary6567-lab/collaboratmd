/**
 * Encrypts small secrets at rest (AES-256-GCM) with a key derived from
 * AUTH_SECRET. A copy of the database alone does not reveal a user's
 * authenticator secret; it would also take the application's key.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(secret: Uint8Array): Buffer {
  return createHash("sha256").update(Buffer.from(secret)).update("collaboratmd:seal:v1").digest();
}

export function seal(plain: string, secret: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function unseal(sealed: string, secret: Uint8Array): string {
  const [v, iv, tag, body] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable sealed value");
  const decipher = createDecipheriv("aes-256-gcm", key(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
