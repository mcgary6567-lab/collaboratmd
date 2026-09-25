import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";

const COOKIE = "collaboratmd_session";

/**
 * Key used to sign session tokens.
 *
 * Falls back to a fixed development value only outside production. A deployed
 * app running on a published default would let anyone forge a session, so
 * production refuses to start a session without AUTH_SECRET.
 */
const secret = () => {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return new TextEncoder().encode(configured);
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set in production. Generate one with: openssl rand -base64 32");
  }
  return new TextEncoder().encode("dev-only-secret-change-me-please-0123456789");
};

/** The same key signs short-lived patient check-in tokens, under their own audience. */
export const signingKey = secret;

export interface Session {
  userId: string;
  practiceId: string;
  name: string;
  email: string;
  role: string;
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export type LoginResult = { ok: true; session: Session } | { ok: false; error: string } | { ok: false; mfa: true };

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.nJkS1sVqsR6kbXQLzGfUlSYxkT1e";
const MFA_COOKIE = "collaboratmd_mfa";
const MFA_AUDIENCE = "collaboratmd:mfa";

export async function login(email: string, password: string): Promise<LoginResult> {
  const { isLocked, recordFailure, clearFailures } = await import("@/server/mfa");
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase().trim())).limit(1);
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, error: "Invalid email or password." };
  }
  if (isLocked(user)) return { ok: false, error: "Too many failed attempts. Try again in 15 minutes." };
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const r = await recordFailure(db, user.id);
    return { ok: false, error: r.locked ? "Too many failed attempts. The account is locked for 15 minutes." : "Invalid email or password." };
  }
  if (user.mfaSecret) {
    // Password proven; the session waits for the second factor.
    const pending = await new SignJWT({ userId: user.id }).setProtectedHeader({ alg: "HS256" }).setAudience(MFA_AUDIENCE).setIssuedAt().setExpirationTime("5m").sign(secret());
    const jar = await cookies();
    jar.set(MFA_COOKIE, pending, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/login", maxAge: 300 });
    return { ok: false, mfa: true };
  }
  await clearFailures(db, user.id);
  const session: Session = { userId: user.id, practiceId: user.practiceId, name: user.name, email: user.email, role: user.role };
  await issue(session);
  await db.insert(schema.auditLog).values({ practiceId: user.practiceId, userId: user.id, action: "login", entity: "user", entityId: user.id });
  return { ok: true, session };
}

/** Second step of sign-in: a code from the authenticator app or a recovery code. */
export async function completeMfaLogin(code: string): Promise<LoginResult> {
  const { isLocked, recordFailure, clearFailures, checkCode } = await import("@/server/mfa");
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  let userId: string;
  try {
    const { payload } = await jwtVerify(token ?? "", secret(), { audience: MFA_AUDIENCE });
    userId = String(payload.userId);
  } catch {
    return { ok: false, error: "Your sign-in timed out. Enter your password again." };
  }
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) return { ok: false, error: "Your sign-in timed out. Enter your password again." };
  if (isLocked(user)) {
    jar.delete({ name: MFA_COOKIE, path: "/login" });
    return { ok: false, error: "Too many failed attempts. Try again in 15 minutes." };
  }
  const kind = await checkCode(db, user.id, code, secret());
  if (!kind) {
    const r = await recordFailure(db, user.id);
    if (r.locked) jar.delete({ name: MFA_COOKIE, path: "/login" });
    return { ok: false, error: r.locked ? "Too many failed attempts. The account is locked for 15 minutes." : "That code is not valid. Use the newest code from your app." };
  }
  jar.delete({ name: MFA_COOKIE, path: "/login" });
  await clearFailures(db, user.id);
  const session: Session = { userId: user.id, practiceId: user.practiceId, name: user.name, email: user.email, role: user.role };
  await issue(session);
  await db.insert(schema.auditLog).values({ practiceId: user.practiceId, userId: user.id, action: "login", entity: "user", entityId: user.id, details: { mfa: kind } });
  return { ok: true, session };
}

/** Whether this browser is between the password and the code. */
export async function hasPendingMfa(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret(), { audience: MFA_AUDIENCE });
    return true;
  } catch {
    return false;
  }
}

async function issue(session: Session) {
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
}

/**
 * The user's role in a practice, or null if they have no access to it. A
 * membership decides; a user always has their own practice with their own
 * role. Checked on every request, so removing access takes effect at once.
 */
export async function roleIn(db: Db, userId: string, practiceId: string): Promise<string | null> {
  const [m] = await db
    .select({ role: schema.practiceMemberships.role })
    .from(schema.practiceMemberships)
    .where(and(eq(schema.practiceMemberships.userId, userId), eq(schema.practiceMemberships.practiceId, practiceId)))
    .limit(1);
  if (m) return m.role;
  const [u] = await db.select({ practiceId: schema.users.practiceId, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return u && u.practiceId === practiceId ? u.role : null;
}

/** Practices the user can work in, their own first. */
export async function accessiblePractices(db: Db, userId: string) {
  const [u] = await db.select({ practiceId: schema.users.practiceId, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!u) return [];
  const rows = await db
    .select({ id: schema.practices.id, name: schema.practices.name, role: schema.practiceMemberships.role })
    .from(schema.practiceMemberships)
    .innerJoin(schema.practices, eq(schema.practices.id, schema.practiceMemberships.practiceId))
    .where(eq(schema.practiceMemberships.userId, userId));
  if (!rows.some((r) => r.id === u.practiceId)) {
    const [home] = await db.select({ id: schema.practices.id, name: schema.practices.name }).from(schema.practices).where(eq(schema.practices.id, u.practiceId)).limit(1);
    if (home) rows.push({ ...home, role: u.role });
  }
  return rows.sort((a, b) => (a.id === u.practiceId ? -1 : b.id === u.practiceId ? 1 : a.name.localeCompare(b.name)));
}

/** Moves the signed-in user to another practice they have access to. */
export async function switchPractice(practiceId: string): Promise<Session> {
  const current = await requireSession();
  const db = await getDb();
  const role = await roleIn(db, current.userId, practiceId);
  if (!role) throw new Error("You do not have access to that practice");
  const next: Session = { ...current, practiceId, role };
  await issue(next);
  await db.insert(schema.auditLog).values({ practiceId, userId: current.userId, action: "switch_practice", entity: "practice", entityId: practiceId, details: { from: current.practiceId } });
  return next;
}

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/**
 * Returns the signed-in user, or null.
 *
 * The token is self-contained, so it can outlive the account it names (a
 * deleted user, or a database reset underneath it). Confirming the user still
 * exists turns that into a clean re-login rather than an app that renders
 * every page empty, and doubles as a revocation check.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  let session: Session;
  try {
    const { payload } = await jwtVerify(token, secret());
    // Staff tokens carry no audience; anything that does (a patient check-in token) is not a staff session.
    if (payload.aud !== undefined) return null;
    session = {
      userId: String(payload.userId),
      practiceId: String(payload.practiceId),
      name: String(payload.name),
      email: String(payload.email),
      role: String(payload.role),
    };
  } catch {
    return null;
  }
  // The user must still exist and still have access to this practice; the
  // role comes from the database, not the token, so a changed role applies now.
  const db = await getDb();
  const role = await roleIn(db, session.userId, session.practiceId);
  return role ? { ...session, role } : null;
}

/** Returns the signed-in user, or redirects to the login page. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Everyone but read-only users may do day-to-day work. */
export const CAN_WRITE = ["admin", "biller", "front_desk"] as const;
/** Moving money, writing it off, or taking back what a payer paid. */
export const CAN_ADJUST = ["admin", "biller"] as const;

/** Returns the signed-in user if their role is one of `roles`, else throws. */
export async function requireRole(roles: readonly string[]): Promise<Session> {
  const s = await requireSession();
  if (!roles.includes(s.role)) {
    throw new Error(s.role === "readonly" ? "Your account is read-only" : "Your role does not allow this; ask a biller or administrator");
  }
  return s;
}
