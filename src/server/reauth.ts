/**
 * Proving it is still the signed-in person, before something sensitive (opening
 * a restricted record): someone at an unlocked desk has the session but not the
 * password or the phone.
 *
 * - With two-factor on: a current code from the authenticator app (or a
 *   recovery code).
 * - Otherwise: the password.
 * - Signed in through single sign-on, without two-factor here: there is no
 *   password to ask for, so the sign-in itself must be recent (RECENT_SSO_MINUTES).
 *
 * Wrong answers count towards the same lockout as signing in, so this cannot be
 * used to guess a password.
 */
import bcrypt from "bcryptjs";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { checkCode, clearFailures, isLocked, recordFailure } from "./mfa";

const { users, auditLog } = schema;
export const RECENT_SSO_MINUTES = 15;

export type ReauthNeed = "code" | "password" | "recent_sso";

/** What this person must give to prove it is them. */
export async function reauthNeeds(db: Db, userId: string, sso: boolean): Promise<ReauthNeed> {
  const [u] = await db.select({ mfaSecret: users.mfaSecret }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.mfaSecret) return "code";
  return sso ? "recent_sso" : "password";
}

export async function reauthenticate(
  db: Db,
  who: { userId: string; practiceId: string; sso?: boolean },
  proof: { password?: string; code?: string },
  key: Uint8Array,
  now = new Date(),
) {
  const [u] = await db.select().from(users).where(eq(users.id, who.userId)).limit(1);
  if (!u) throw new Error("Sign in again");
  if (isLocked(u, now)) throw new Error("Too many wrong attempts. Try again in 15 minutes.");
  const need = await reauthNeeds(db, who.userId, !!who.sso);
  if (need === "recent_sso") {
    const [last] = await db
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(and(eq(auditLog.userId, who.userId), eq(auditLog.action, "login")))
      .orderBy(desc(auditLog.at))
      .limit(1);
    if (!last || now.getTime() - last.at.getTime() > RECENT_SSO_MINUTES * 60_000) {
      throw new Error(`Sign out and sign in again with single sign-on, then open the record within ${RECENT_SSO_MINUTES} minutes`);
    }
    return;
  }
  const ok = need === "code" ? !!(await checkCode(db, who.userId, (proof.code ?? "").trim(), key)) : await bcrypt.compare(proof.password ?? "", u.passwordHash);
  if (!ok) {
    const r = await recordFailure(db, who.userId);
    await db.insert(auditLog).values({ practiceId: who.practiceId, userId: who.userId, action: "reauth_failed", entity: "user", entityId: who.userId, details: { need } });
    throw new Error(r.locked ? "Too many wrong attempts. The account is locked for 15 minutes." : need === "code" ? "That code does not match" : "That password is not right");
  }
  await clearFailures(db, who.userId);
}
