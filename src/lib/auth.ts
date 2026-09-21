import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

const COOKIE = "medbill_session";

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
  const token = await new SignJWT({ ...session })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
  await db.insert(schema.auditLog).values({ practiceId: user.practiceId, userId: user.id, action: "login", entity: "user", entityId: user.id });
  return session;
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
  const db = await getDb();
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  return user ? session : null;
}

/** Returns the signed-in user, or redirects to the login page. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
