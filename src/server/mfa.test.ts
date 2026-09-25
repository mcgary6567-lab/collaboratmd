import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { base32Decode, base32Encode, codeAt, stepAt, verifyCode } from "@/lib/totp";
import { seal, unseal } from "@/lib/seal";
import { MAX_FAILURES, checkCode, confirmEnrollment, disableMfa, isLocked, recordFailure, startEnrollment } from "./mfa";

const key = new TextEncoder().encode("test-key-for-sealing-0123456789abcdef");

describe("TOTP (RFC 6238 test vectors, SHA-1)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("encodes the RFC secret and round-trips base32", () => {
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("produces the published codes (last six digits)", () => {
    expect(codeAt(secret, stepAt(59_000))).toBe("287082");
    expect(codeAt(secret, stepAt(1_111_111_109_000))).toBe("081804");
    expect(codeAt(secret, stepAt(1_234_567_890_000))).toBe("005924");
    expect(codeAt(secret, stepAt(2_000_000_000_000))).toBe("279037");
  });
  it("accepts one step of drift and refuses a replayed step", () => {
    const now = 1_234_567_890_000;
    const step = stepAt(now);
    expect(verifyCode(secret, codeAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyCode(secret, codeAt(secret, step - 2), now)).toBeNull();
    expect(verifyCode(secret, codeAt(secret, step), now, step)).toBeNull();
    expect(verifyCode(secret, "12345", now)).toBeNull();
  });
  it("seals and unseals, and a tampered value fails", () => {
    const sealed = seal("SECRET", key);
    expect(unseal(sealed, key)).toBe("SECRET");
    expect(() => unseal(sealed.slice(0, -2) + "AA", key)).toThrow();
  });
});

describe("two-factor enrollment and sign-in checks", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("enrolls only after a correct code, then accepts each code once and each recovery code once", async () => {
    const { secret, uri } = await startEnrollment(t.db, t.userId, key);
    expect(uri).toMatch(/^otpauth:\/\/totp\/CollaboratMD:/);
    await expect(confirmEnrollment(t.db, t.userId, "000000", key)).rejects.toThrow(/does not match/);
    const now = Date.now();
    const recovery = await confirmEnrollment(t.db, t.userId, codeAt(secret, stepAt(now)), key);
    expect(recovery).toHaveLength(10);
    const [u] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    expect(u.mfaSecret).not.toContain(secret); // stored sealed
    expect(u.mfaRecovery.join()).not.toContain(recovery[0]); // stored hashed

    // The code used to enroll cannot be used again to sign in.
    expect(await checkCode(t.db, t.userId, codeAt(secret, stepAt(now)), key)).toBeNull();
    expect(await checkCode(t.db, t.userId, codeAt(secret, stepAt(now) + 1), key)).toBe("totp");
    expect(await checkCode(t.db, t.userId, recovery[3].toLowerCase(), key)).toBe("recovery");
    expect(await checkCode(t.db, t.userId, recovery[3], key)).toBeNull();

    await expect(disableMfa(t.db, t.userId, "999999", key)).rejects.toThrow(/current code/);
    await disableMfa(t.db, t.userId, recovery[0], key);
    const [off] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    expect(off.mfaSecret).toBeNull();
  });

  it("locks the account after repeated failures", async () => {
    for (let i = 1; i < MAX_FAILURES; i++) expect((await recordFailure(t.db, t.userId)).locked).toBe(false);
    expect((await recordFailure(t.db, t.userId)).locked).toBe(true);
    const [u] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    expect(isLocked(u)).toBe(true);
    expect(isLocked(u, new Date(Date.now() + 16 * 60_000))).toBe(false);
  });
});
