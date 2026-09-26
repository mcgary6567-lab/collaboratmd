/**
 * Forgotten passwords: a one-time link by email, valid for an hour and only
 * until the password changes (the token carries a fingerprint of the current
 * password hash). The request page answers the same way whether or not the
 * address has an account, so it cannot be used to find out who does.
 * Setting a new password ends every existing session and clears a lockout.
 */
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import { schema } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { practiceConfig } from "./integrations";
import { sendEmail } from "./notify";

const { users, auditLog } = schema;
const AUDIENCE = "collaboratmd:reset";
const THROTTLE_MS = 5 * 60_000;

const fingerprint = (hash: string) => crypto.createHash("sha256").update(hash).digest("base64url").slice(0, 16);

export async function resetToken(u: { id: string; passwordHash: string }) {
  return new SignJWT({ userId: u.id, pwv: fingerprint(u.passwordHash) }).setProtectedHeader({ alg: "HS256" }).setAudience(AUDIENCE).setIssuedAt().setExpirationTime("1h").sign(appSecret());
}

type Send = (to: string, subject: string, text: string) => Promise<boolean>;

/**
 * Sends the link if the account exists and can use a password. Returns what
 * happened for the audit trail and tests; the page shows the same message
 * either way.
 */
export async function requestReset(db: Db, email: string, origin: string, opts: { send?: Send; now?: Date; requestedBy?: string } = {}) {
  const now = opts.now ?? new Date();
  const [u] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  if (!u || u.disabledAt) return "no_account" as const;
  const domain = u.email.split("@")[1] ?? "";
  const { rows: sso } = await db.execute(sql`SELECT 1 FROM practice_sso WHERE practice_id = ${u.practiceId} AND enforce AND domains ? ${domain} LIMIT 1`);
  if (sso.length) return "sso" as const;
  if (u.passwordResetSentAt && now.getTime() - u.passwordResetSentAt.getTime() < THROTTLE_MS) return "throttled" as const;
  const resend = (await practiceConfig(db, u.practiceId)).resend;
  const send: Send | null = opts.send ?? (resend ? (to, subject, text) => sendEmail(to, subject, text, undefined, resend) : null);
  if (!send) return "no_email" as const;
  const link = `${origin}/reset?token=${encodeURIComponent(await resetToken(u))}`;
  const ok = await send(u.email, "Reset your CollaboratMD password",
    `Hi ${u.name.split(" ")[0]},\n\nSomeone asked to reset the password for ${u.email}. To choose a new one, open this link within an hour:\n\n${link}\n\nIf it was not you, ignore this email; your password stays the same.`);
  await db.update(users).set({ passwordResetSentAt: now }).where(eq(users.id, u.id));
  await db.insert(auditLog).values({ practiceId: u.practiceId, userId: opts.requestedBy ?? u.id, action: "password_reset_requested", entity: "user", entityId: u.id, details: { byAdmin: !!opts.requestedBy, sent: ok } });
  return ok ? ("sent" as const) : ("send_failed" as const);
}

export async function readResetToken(db: Db, token: string) {
  try {
    const { payload } = await jwtVerify(token, appSecret(), { audience: AUDIENCE });
    const [u] = await db.select().from(users).where(eq(users.id, String(payload.userId))).limit(1);
    if (!u || u.disabledAt || payload.pwv !== fingerprint(u.passwordHash)) return null;
    return u;
  } catch {
    return null;
  }
}

export async function completeReset(db: Db, token: string, password: string) {
  const u = await readResetToken(db, token);
  if (!u) throw new Error("This link has expired or was already used. Ask for a new one.");
  if (password.length < 12) throw new Error("Use at least 12 characters");
  await db.update(users).set({ passwordHash: await bcrypt.hash(password, 10), sessionsRevokedAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(users.id, u.id));
  await db.insert(auditLog).values({ practiceId: u.practiceId, userId: u.id, action: "password_reset", entity: "user", entityId: u.id });
  return u.email;
}
