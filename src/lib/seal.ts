/**
 * Encrypts small secrets at rest (AES-256-GCM): integration keys, second-factor
 * secrets, FHIR tokens and signing keys, SSO and webhook secrets. A copy of the
 * database alone does not reveal them; it would also take the application's key.
 *
 * Two formats:
 *   v1  key derived from AUTH_SECRET, the session-signing secret. Rotating
 *       AUTH_SECRET makes these unreadable, so v1 is only read, never written,
 *       once a key ring is set.
 *   v2  a key from the SEAL_KEYS ring, named in the value, so keys can be
 *       rotated independently: add a new key at the front, re-encrypt
 *       (operator console), then drop the old one.
 *
 * SEAL_KEYS is "id=base64key[,id=base64key...]", current key first, each key
 * 32 random bytes (openssl rand -base64 32).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function derived(secret: Uint8Array): Buffer {
  return createHash("sha256").update(Buffer.from(secret)).update("collaboratmd:seal:v1").digest();
}

type Ring = { current: string; keys: Map<string, Buffer> };
let cached: { raw: string; ring: Ring | null } | null = null;

export function keyRing(): Ring | null {
  const raw = process.env.SEAL_KEYS?.trim() ?? "";
  if (cached && cached.raw === raw) return cached.ring;
  let ring: Ring | null = null;
  if (raw) {
    const keys = new Map<string, Buffer>();
    for (const part of raw.split(",").map((p) => p.trim()).filter(Boolean)) {
      const m = part.match(/^([A-Za-z0-9_-]{1,16})=(.+)$/);
      if (!m) throw new Error("SEAL_KEYS must look like id=base64key,id=base64key");
      const key = Buffer.from(m[2], "base64");
      if (key.length !== 32) throw new Error(`SEAL_KEYS key ${m[1]} must be 32 bytes (openssl rand -base64 32)`);
      keys.set(m[1], key);
    }
    ring = { current: raw.split(",")[0].split("=")[0].trim(), keys };
  }
  cached = { raw, ring };
  return ring;
}

function encrypt(plain: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")];
}

function decrypt(key: Buffer, iv: string, tag: string, body: string) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** Seals with the current ring key when a ring is set, otherwise with the AUTH_SECRET-derived key. */
export function seal(plain: string, secret: Uint8Array): string {
  const ring = keyRing();
  if (ring) return ["v2", ring.current, ...encrypt(plain, ring.keys.get(ring.current)!)].join(".");
  return ["v1", ...encrypt(plain, derived(secret))].join(".");
}

export function unseal(sealed: string, secret: Uint8Array): string {
  const parts = sealed.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    const key = keyRing()?.keys.get(parts[1]);
    if (!key) throw new Error(`Sealed with key ${parts[1]}, which is not in SEAL_KEYS`);
    return decrypt(key, parts[2], parts[3], parts[4]);
  }
  const [v, iv, tag, body] = parts;
  if (v !== "v1" || !iv || !tag || !body) throw new Error("Unreadable sealed value");
  return decrypt(derived(secret), iv, tag, body);
}

/** True when the value is already sealed with the ring's current key. */
export function sealedWithCurrent(sealed: string): boolean {
  const ring = keyRing();
  return !!ring && sealed.startsWith(`v2.${ring.current}.`);
}
