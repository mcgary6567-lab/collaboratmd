/**
 * Self-serve signup: a practice creates its own account, proves the email is
 * theirs by clicking a link, and starts on a trial. Nothing is created until
 * the link is used, so a typo'd or hostile signup leaves no practice behind.
 *
 * The form's answer never reveals whether an email already has an account:
 * that person gets an email saying so (with the sign-in and reset links)
 * instead of a verification link.
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { TIERS } from "@/content/pricing";
import { recordAcceptance } from "./legal";

const { signups, users, practices, auditLog } = schema;
type Send = (to: string, subject: string, text: string) => Promise<boolean>;

export const LINK_HOURS = 24;
export const trialDays = () => Math.min(90, Math.max(1, Number(process.env.TRIAL_DAYS) || 14));
/** Plans a practice can start on its own; the rest go through sales. */
export const SELF_SERVE_PLANS = TIERS.filter((t) => t.priceMonthly !== null && t.cta !== "Talk to sales").map((t) => t.id);

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export type SignupInput = { name: string; email: string; practiceName: string; password: string; plan?: string | null };

export function validateSignup(input: SignupInput) {
  const v = {
    name: input.name.trim().slice(0, 80),
    email: input.email.trim().toLowerCase(),
    practiceName: input.practiceName.trim().slice(0, 100),
    password: input.password,
    plan: input.plan && SELF_SERVE_PLANS.includes(input.plan) ? input.plan : SELF_SERVE_PLANS[0] ?? null,
  };
  if (!v.name) throw new Error("Enter your name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || v.email.length > 200) throw new Error("Enter a valid work email");
  if (v.practiceName.length < 2) throw new Error("Enter the practice or company name");
  if (v.password.length < 12) throw new Error("Use a password of at least 12 characters");
  if (v.password.length > 200) throw new Error("That password is too long");
  return v;
}

/** Records the signup and emails the confirmation link. Always resolves the same way for the caller. */
export async function startSignup(db: Db, input: SignupInput, origin: string, opts: { send: Send; now?: Date }) {
  const v = validateSignup(input);
  const now = opts.now ?? new Date();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, v.email)).limit(1);
  if (existing) {
    await opts.send(v.email, "You already have a CollaboratMD account", `Someone (probably you) tried to sign up with this email, but it already has an account.\n\nSign in: ${origin}/login\nForgot the password: ${origin}/login/forgot\n\nIf this wasn't you, you can ignore this email.`);
    return { sent: true };
  }
  // At most three links an hour for one address, so the form cannot be used to flood an inbox.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(signups).where(and(sql`lower(${signups.email}) = ${v.email}`, gte(signups.createdAt, new Date(now.getTime() - 3_600_000))));
  if (Number(n) >= 3) return { sent: true };
  const token = randomBytes(32).toString("base64url");
  await db.insert(signups).values({
    email: v.email, name: v.name, practiceName: v.practiceName, plan: v.plan,
    passwordHash: await bcrypt.hash(v.password, 10), tokenHash: hash(token),
    expiresAt: new Date(now.getTime() + LINK_HOURS * 3_600_000), createdAt: now,
  });
  const link = `${origin}/signup/verify?token=${encodeURIComponent(token)}`;
  await opts.send(v.email, "Confirm your email to create your CollaboratMD practice", `Hi ${v.name},\n\nConfirm your email to create ${v.practiceName} on CollaboratMD:\n\n${link}\n\nThe link works for ${LINK_HOURS} hours. Your ${trialDays()}-day trial starts when you confirm.\n\nIf you didn't sign up, ignore this email and nothing is created.`);
  return { sent: true };
}

export async function readSignup(db: Db, token: string, now = new Date()) {
  if (!token) return null;
  const [row] = await db.select().from(signups).where(eq(signups.tokenHash, hash(token))).limit(1);
  if (!row || row.completedAt || row.expiresAt <= now) return null;
  return row;
}

/** Creates the practice and its first administrator, once per link. */
export async function completeSignup(db: Db, token: string, now = new Date(), ip?: string | null) {
  const pending = await readSignup(db, token, now);
  if (!pending) throw new Error("This link has expired or was already used. Sign up again, or sign in if you finished before.");
  const claimed = await db.update(signups).set({ completedAt: now }).where(and(eq(signups.id, pending.id), isNull(signups.completedAt))).returning();
  if (!claimed.length) throw new Error("This link was already used. Sign in with the email and password you chose.");
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, pending.email)).limit(1);
  if (taken) throw new Error("An account with this email already exists. Sign in instead.");

  const [practice] = await db.insert(practices).values({
    name: pending.practiceName,
    // Filled in from the setup guide; claims cannot go out until they are.
    taxId: "", npi: "", address1: "", city: "", state: "", zip: "",
    selfServe: true, plan: pending.plan, subscriptionStatus: "trialing",
    // New practices start with two-factor required for administrators and exporters (server/mfa-policy.ts).
    mfaForPrivileged: true,
    trialEndsAt: new Date(now.getTime() + trialDays() * 86_400_000), billingEmail: pending.email,
  }).returning();
  const [user] = await db.insert(users).values({ practiceId: practice.id, email: pending.email, passwordHash: pending.passwordHash, name: pending.name, role: "admin" }).returning();
  await db.update(signups).set({ practiceId: practice.id }).where(eq(signups.id, pending.id));
  // The terms were agreed on the signup form, so the acceptance is dated then.
  await recordAcceptance(db, { practiceId: practice.id, userId: user.id, ip, at: pending.createdAt });
  await db.insert(auditLog).values({ practiceId: practice.id, userId: user.id, action: "practice_created", entity: "practice", entityId: practice.id, details: { selfServe: true, plan: pending.plan } });
  return { practiceId: practice.id, userId: user.id, email: pending.email };
}
