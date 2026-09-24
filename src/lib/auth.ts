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

export async function login(email: string, password: string): Promise<Session | null> {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase().trim())).limit(1);
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  const session: Session = { userId: user.id, practiceId: user.practiceId, name: user.name, email: user.email, role: user.role };
  await issue(session);
  await db.insert(schema.auditLog).values({ practiceId: user.practiceId, userId: user.id, action: "login", entity: "user", entityId: user.id });
  return session;
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
