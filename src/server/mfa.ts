/**
 * Two-factor sign-in and account lockout.
 *
 * Enrollment: a new secret is kept, encrypted, as pending until the user
 * proves their app produces the right code; only then does it become the
 * active secret, and ten recovery codes are issued (shown once, stored as
 * hashes). Sign-in: after the password, a code from the app or one unused
 * recovery code. A code is accepted once: its time step is remembered.
 *
 * Lockout: five wrong passwords or codes lock the account for 15 minutes.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUri, verifyCode } from "@/lib/totp";
import { seal, unseal } from "@/lib/seal";

const { users } = schema;

export const MAX_FAILURES = 5;
export const LOCK_MINUTES = 15;

async function getUser(db: Db, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) throw new Error("User not found");
  return u;
}

export function isLocked(u: { lockedUntil: Date | null }, now = new Date()) {
  return !!u.lockedUntil && u.lockedUntil > now;
}

/** Counts a failed password or code; locks the account at the limit. */
export async function recordFailure(db: Db, userId: string) {
  const [u] = await db
    .update(users)
    .set({ failedLogins: sql`${users.failedLogins} + 1` })
    .where(eq(users.id, userId))
    .returning();
  if (u.failedLogins >= MAX_FAILURES) {
    await db.update(users).set({ lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000), failedLogins: 0 }).where(eq(users.id, userId));
    return { locked: true };
  }
  return { locked: false, remaining: MAX_FAILURES - u.failedLogins };
}

export async function clearFailures(db: Db, userId: string) {
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
}

export async function startEnrollment(db: Db, userId: string, key: Uint8Array) {
  const u = await getUser(db, userId);
  const secret = newSecret();
  await db.update(users).set({ mfaPendingSecret: seal(secret, key) }).where(eq(users.id, userId));
  return { secret, uri: otpauthUri(secret, u.email) };
}

/** Activates the pending secret if `code` matches it. Returns the recovery codes, once. */
export async function confirmEnrollment(db: Db, userId: string, code: string, key: Uint8Array) {
  const u = await getUser(db, userId);
  if (!u.mfaPendingSecret) throw new Error("Start setup again: no pending authenticator");
  const secret = unseal(u.mfaPendingSecret, key);
  const step = verifyCode(secret, code);
  if (step === null) throw new Error("That code does not match. Check the time on your phone and try the newest code.");
  const codes = newRecoveryCodes();
  await db
    .update(users)
    .set({ mfaSecret: u.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecovery: codes.map(hashRecoveryCode) })
    .where(eq(users.id, userId));
  await db.insert(schema.auditLog).values({ practiceId: u.practiceId, userId, action: "mfa_enabled", entity: "user", entityId: userId });
  return codes;
}

/**
 * Checks a sign-in code: an authenticator code (not reused) or a recovery
 * code (used up). Does not count failures; the caller does.
 */
export async function checkCode(db: Db, userId: string, code: string, key: Uint8Array): Promise<"totp" | "recovery" | null> {
  const u = await getUser(db, userId);
  if (!u.mfaSecret) return null;
  const step = verifyCode(unseal(u.mfaSecret, key), code, Date.now(), u.mfaLastStep);
  if (step !== null) {
    await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, userId));
    return "totp";
  }
  const h = hashRecoveryCode(code);
  if (code.replace(/\W/g, "").length === 10 && u.mfaRecovery.includes(h)) {
    await db.update(users).set({ mfaRecovery: u.mfaRecovery.filter((x) => x !== h) }).where(eq(users.id, userId));
    await db.insert(schema.auditLog).values({ practiceId: u.practiceId, userId, action: "mfa_recovery_code_used", entity: "user", entityId: userId, details: { remaining: u.mfaRecovery.length - 1 } });
    return "recovery";
  }
  return null;
}

export async function disableMfa(db: Db, userId: string, code: string, key: Uint8Array) {
  const u = await getUser(db, userId);
  if (!u.mfaSecret) return;
  if (!(await checkCode(db, userId, code, key))) throw new Error("Enter a current code from your app, or a recovery code, to turn two-factor off");
  await db.update(users).set({ mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecovery: [] }).where(eq(users.id, userId));
  await db.insert(schema.auditLog).values({ practiceId: u.practiceId, userId, action: "mfa_disabled", entity: "user", entityId: userId });
}

export async function regenerateRecoveryCodes(db: Db, userId: string, code: string, key: Uint8Array) {
  if (!(await checkCode(db, userId, code, key))) throw new Error("Enter a current code from your app first");
  const codes = newRecoveryCodes();
  await db.update(users).set({ mfaRecovery: codes.map(hashRecoveryCode) }).where(eq(users.id, userId));
  return codes;
}

export async function mfaStatus(db: Db, userId: string) {
  const u = await getUser(db, userId);
  return { enabled: !!u.mfaSecret, enabledAt: u.mfaEnabledAt, recoveryLeft: u.mfaRecovery.length };
}
