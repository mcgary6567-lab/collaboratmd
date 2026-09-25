import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { appSecret as secret } from "@/lib/app-secret";
import { allows, type Capability } from "@/lib/capabilities";
import { clientIp, ipAllowed } from "@/lib/ip";

const COOKIE = "collaboratmd_session";

/** The same key signs short-lived patient check-in tokens, under their own audience. */
export const signingKey = secret;

export interface Session {
  userId: string;
  practiceId: string;
  name: string;
  email: string;
  /** The built-in role (admin | biller | front_desk | readonly); a custom role resolves to its base. */
  role: string;
  /** A custom role's name, when the user has one. */
  customRole?: string | null;
  /** Abilities the custom role switches off. */
  denied?: string[];
  /** Signed in through the practice's identity provider (which handles two-factor). */
  sso?: boolean;
  /** When the user actually signed in (seconds); a practice switch keeps it, so the session limit still applies. */
  authAt?: number;
}

/**
 * What stops a user who proved who they are: a deactivated account, a
 * practice that signs in only through its identity provider, or an address
 * outside the practice's allowlist.
 */
async function signInBlock(db: Db, user: typeof schema.users.$inferSelect, via: "password" | "sso"): Promise<string | null> {
  if (user.disabledAt) return "This account has been deactivated. Ask your practice administrator.";
  const [practice] = await db.select({ ipAllowlist: schema.practices.ipAllowlist }).from(schema.practices).where(eq(schema.practices.id, user.practiceId)).limit(1);
  const ip = clientIp(await headers());
  if (practice && !ipAllowed(ip, practice.ipAllowlist)) return `Your practice allows sign-in only from its approved networks. This connection (${ip ?? "unknown address"}) is not one of them.`;
  if (via === "password") {
    const domain = user.email.split("@")[1]?.toLowerCase() ?? "";
    const { rows } = await db.execute<{ n: number }>(sql`SELECT 1 AS n FROM practice_sso WHERE practice_id = ${user.practiceId} AND enforce AND domains ? ${domain} LIMIT 1`);
    if (rows.length) return "Your organization signs in with single sign-on. Choose \"Sign in with SSO\" instead.";
  }
  return null;
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
  const blocked = await signInBlock(db, user, "password");
  if (blocked) return { ok: false, error: blocked };
  if (user.mfaSecret) {
    // Password proven; the session waits for the second factor.
    const pending = await new SignJWT({ userId: user.id }).setProtectedHeader({ alg: "HS256" }).setAudience(MFA_AUDIENCE).setIssuedAt().setExpirationTime("5m").sign(secret());
    const jar = await cookies();
    jar.set(MFA_COOKIE, pending, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/login", maxAge: 300 });
    return { ok: false, mfa: true };
  }
  await clearFailures(db, user.id);
  const session: Session = { userId: user.id, practiceId: user.practiceId, name: user.name, email: user.email, role: user.role };
  await issue(db, session);
  await db.insert(schema.auditLog).values({ practiceId: user.practiceId, userId: user.id, action: "login", entity: "user", entityId: user.id });
  return { ok: true, session };
}

/** Starts a session for a user the practice's identity provider vouched for (see server/sso.ts). */
export async function startSsoSession(db: Db, user: typeof schema.users.$inferSelect, practiceId: string): Promise<Session> {
  const blocked = await signInBlock(db, user, "sso");
  if (blocked) throw new Error(blocked);
  const role = await roleIn(db, user.id, practiceId);
  if (!role) throw new Error("This account has no access to the practice");
  const session: Session = { userId: user.id, practiceId, name: user.name, email: user.email, role, sso: true };
  await issue(db, session);
  await db.insert(schema.auditLog).values({ practiceId, userId: user.id, action: "login", entity: "user", entityId: user.id, details: { sso: true } });
  return session;
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
  const blocked = await signInBlock(db, user, "password");
  if (blocked) return { ok: false, error: blocked };
  await clearFailures(db, user.id);
  const session: Session = { userId: user.id, practiceId: user.practiceId, name: user.name, email: user.email, role: user.role };
  await issue(db, session);
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

/** Signs the session cookie. It lasts as long as the practice's session limit, counted from when the user signed in. */
async function issue(db: Db, session: Session) {
  const [practice] = await db.select({ hours: schema.practices.sessionHours }).from(schema.practices).where(eq(schema.practices.id, session.practiceId)).limit(1);
  const now = Math.floor(Date.now() / 1000);
  const authAt = session.authAt ?? now;
  const remaining = Math.max(60, authAt + (practice?.hours ?? 12) * 3600 - now);
  const { userId, practiceId, name, email, role, sso } = session;
  const token = await new SignJWT({ userId, practiceId, name, email, role, sso: !!sso, authAt })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(now + remaining)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: remaining });
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
  await issue(db, next);
  await db.insert(schema.auditLog).values({ practiceId, userId: current.userId, action: "switch_practice", entity: "practice", entityId: practiceId, details: { from: current.practiceId } });
  return next;
}

/** Starts a fresh session for the signed-in user, e.g. for the administrator who just signed everyone else out. */
export async function renewSession() {
  const current = await requireSession();
  await issue(await getDb(), { ...current, authAt: Math.ceil(Date.now() / 1000) + 1 });
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
      sso: payload.sso === true,
      authAt: Number(payload.authAt ?? payload.iat ?? 0),
    };
  } catch {
    return null;
  }
  // The user must still exist, be active and have access to this practice; the
  // role comes from the database, not the token, so a changed role applies now.
  // The practice's session limit and network allowlist are checked each time too.
  const db = await getDb();
  const access = await accessFor(db, session.userId, session.practiceId);
  if (!access) return null;
  if (Date.now() / 1000 - (session.authAt ?? 0) > access.sessionHours * 3600) return null;
  if (access.ipAllowlist.length && !ipAllowed(clientIp(await headers()), access.ipAllowlist)) return null;
  // An administrator signed everyone (or this person) out after this session began.
  if (access.revokedAt && (session.authAt ?? 0) * 1000 < access.revokedAt) return null;
  return { ...session, role: access.role, customRole: access.customRole, denied: access.denied };
}

/** The user's effective role in a practice and the practice's session policy, or null if they may not use it. */
export async function accessFor(db: Db, userId: string, practiceId: string) {
  const { rows } = await db.execute<{ disabled_at: string | null; home: string; home_role: string; member_role: string | null; session_hours: number; ip_allowlist: string[]; user_revoked: string | null; practice_revoked: string | null }>(sql`
    SELECT u.disabled_at, u.practice_id AS home, u.role AS home_role, u.sessions_revoked_at::text AS user_revoked, p.sessions_revoked_at::text AS practice_revoked,
      (SELECT m.role FROM practice_memberships m WHERE m.user_id = u.id AND m.practice_id = ${practiceId} LIMIT 1) AS member_role,
      p.session_hours, p.ip_allowlist
    FROM users u JOIN practices p ON p.id = ${practiceId}
    WHERE u.id = ${userId}`);
  const r = rows[0];
  if (!r || r.disabled_at) return null;
  const raw = r.member_role ?? (r.home === practiceId ? r.home_role : null);
  if (!raw) return null;
  let role = raw, customRole: string | null = null, denied: string[] = [];
  if (raw.startsWith("custom:")) {
    const [c] = await db.select().from(schema.customRoles).where(and(eq(schema.customRoles.id, raw.slice(7)), eq(schema.customRoles.practiceId, practiceId))).limit(1);
    if (!c) return null;
    role = c.baseRole; customRole = c.name; denied = c.denied;
  }
  const revokedAt = Math.max(r.user_revoked ? Date.parse(r.user_revoked) : 0, r.practice_revoked ? Date.parse(r.practice_revoked) : 0) || null;
  return { role, customRole, denied, sessionHours: Number(r.session_hours) || 12, ipAllowlist: (r.ip_allowlist ?? []) as string[], revokedAt };
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
  // A custom role narrows its built-in role: day-to-day work and money can each be switched off.
  const cap = roles === CAN_ADJUST ? "adjust" : roles === CAN_WRITE ? "write" : null;
  if (cap && s.denied?.includes(cap)) throw new Error(`Your role (${s.customRole}) does not allow this; ask an administrator`);
  return s;
}

/** Whether the signed-in user can use a feature (reports, exports, texting). */
export function can(s: Session, cap: Capability) {
  return allows(s.role, s.denied, cap);
}

export async function requireCapability(cap: Capability): Promise<Session> {
  const s = await requireSession();
  if (!can(s, cap)) throw new Error(`Your role${s.customRole ? ` (${s.customRole})` : ""} does not include this`);
  return s;
}
