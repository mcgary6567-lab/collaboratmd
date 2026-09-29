/**
 * Passkeys: adding one while signed in, and signing in with one. A passkey
 * proves possession of the device and, with user verification required, the
 * person's PIN or biometric: it counts as two-factor sign-in, and it cannot be
 * phished because it only works on this site's domain.
 */
import { randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { b64url, verifyAssertion, verifyRegistration } from "@/lib/webauthn";

const { passkeys, passkeyChallenges, users, auditLog } = schema;
const TTL = 5 * 60_000;

export type Site = { origin: string; rpId: string; name: string };
export const siteFor = (origin: string): Site => ({ origin, rpId: new URL(origin).hostname, name: "CollaboratMD" });

async function newChallenge(db: Db, purpose: "register" | "login", userId: string | null) {
  await db.delete(passkeyChallenges).where(lt(passkeyChallenges.expiresAt, new Date()));
  const challenge = b64url.encode(randomBytes(32));
  const [row] = await db.insert(passkeyChallenges).values({ challenge, purpose, userId, expiresAt: new Date(Date.now() + TTL) }).returning();
  return row;
}

/** Takes a challenge once: a used or expired one is refused. */
async function takeChallenge(db: Db, id: string, purpose: string, userId: string | null) {
  const [row] = await db.delete(passkeyChallenges).where(and(eq(passkeyChallenges.id, id), eq(passkeyChallenges.purpose, purpose))).returning();
  if (!row || row.expiresAt < new Date() || (userId !== null && row.userId !== userId)) throw new Error("The request expired; try again");
  return row.challenge;
}

export async function registrationOptions(db: Db, user: { id: string; email: string; name: string }, site: Site) {
  const c = await newChallenge(db, "register", user.id);
  const existing = await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, user.id));
  return {
    challengeId: c.id,
    publicKey: {
      challenge: c.challenge,
      rp: { id: site.rpId, name: site.name },
      user: { id: b64url.encode(Buffer.from(user.id)), name: user.email, displayName: user.name },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -8 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      timeout: TTL,
      excludeCredentials: existing.map((e) => ({ type: "public-key", id: e.id })),
    },
  };
}

export async function finishRegistration(db: Db, userId: string, challengeId: string, response: { attestationObject: string; clientDataJSON: string; transports?: string[] }, name: string, site: Site) {
  const challenge = await takeChallenge(db, challengeId, "register", userId);
  const v = verifyRegistration(response, { challenge, origin: site.origin, rpId: site.rpId });
  const [u] = await db.select({ practiceId: users.practiceId }).from(users).where(eq(users.id, userId)).limit(1);
  await db.insert(passkeys).values({ id: v.id, userId, publicKey: v.publicKey, algorithm: v.algorithm, signCount: v.signCount, transports: response.transports ?? null, name: name.trim().slice(0, 60) || "Passkey" });
  await db.insert(auditLog).values({ practiceId: u.practiceId, userId, action: "passkey_added", entity: "user", entityId: userId, details: { name } });
  return v.id;
}

export async function loginOptions(db: Db, site: Site) {
  const c = await newChallenge(db, "login", null);
  return { challengeId: c.id, publicKey: { challenge: c.challenge, rpId: site.rpId, userVerification: "required", timeout: TTL, allowCredentials: [] } };
}

/** Verifies a sign-in and returns the user it belongs to. */
export async function finishLogin(db: Db, challengeId: string, response: { id: string; authenticatorData: string; clientDataJSON: string; signature: string }, site: Site) {
  const challenge = await takeChallenge(db, challengeId, "login", null);
  const [key] = await db.select().from(passkeys).where(eq(passkeys.id, response.id)).limit(1);
  if (!key) throw new Error("This passkey is not registered here; sign in with your password and add it under Sign-in security");
  const { signCount } = verifyAssertion(response, key, { challenge, origin: site.origin, rpId: site.rpId });
  await db.update(passkeys).set({ signCount, lastUsedAt: new Date() }).where(eq(passkeys.id, key.id));
  const [user] = await db.select().from(users).where(eq(users.id, key.userId)).limit(1);
  return user;
}

export async function listPasskeys(db: Db, userId: string) {
  return db.select({ id: passkeys.id, name: passkeys.name, createdAt: passkeys.createdAt, lastUsedAt: passkeys.lastUsedAt }).from(passkeys).where(eq(passkeys.userId, userId));
}

export async function removePasskey(db: Db, userId: string, id: string) {
  const [row] = await db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, userId))).returning();
  if (row) {
    const [u] = await db.select({ practiceId: users.practiceId }).from(users).where(eq(users.id, userId)).limit(1);
    await db.insert(auditLog).values({ practiceId: u.practiceId, userId, action: "passkey_removed", entity: "user", entityId: userId, details: { name: row.name } });
  }
}

export async function hasPasskey(db: Db, userId: string) {
  const [row] = await db.select({ id: passkeys.id }).from(passkeys).where(eq(passkeys.userId, userId)).limit(1);
  return !!row;
}
