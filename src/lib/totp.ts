/**
 * Time-based one-time passwords (RFC 6238), the six-digit codes authenticator
 * apps show. HMAC-SHA1 over a 30-second counter, which is what Google
 * Authenticator, Microsoft Authenticator, 1Password and Authy expect.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 encoded. */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks a code against the current step and one step either side (clock
 * drift). Returns the matching step so the caller can refuse to accept the
 * same code twice, or null.
 */
export function verifyCode(secret: string, code: string, now = Date.now(), lastUsedStep?: number | null): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep != null && step <= lastUsedStep) continue;
    const expected = Buffer.from(codeAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "CollaboratMD"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/** Ten single-use recovery codes, shown once; only their hashes are kept. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: 10 }, () => {
    const hex = randomBytes(5).toString("hex").toUpperCase();
    return `${hex.slice(0, 5)}-${hex.slice(5)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}
