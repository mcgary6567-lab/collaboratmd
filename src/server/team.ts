/**
 * The practice's team: who has access, with which role, custom roles, invites
 * for new staff, and the practice's sign-in policy (session length and the
 * networks sign-in is allowed from).
 */
import crypto from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import type { Db } from "@/db";
import { schema } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { BUILT_IN_ROLES, CAPABILITIES } from "@/lib/capabilities";
import { ipAllowed, parseCidr } from "@/lib/ip";

const { users, practiceMemberships, customRoles, practices, auditLog } = schema;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Member = { userId: string; name: string; email: string; role: string; roleLabel: string; home: boolean; disabled: boolean; mfa: boolean };

export async function listTeam(db: Db, practiceId: string): Promise<Member[]> {
  const roles = await listCustomRoles(db, practiceId);
  const label = (r: string) => BUILT_IN_ROLES[r] ?? roles.find((c) => `custom:${c.id}` === r)?.name ?? r;
  const home = await db.select().from(users).where(eq(users.practiceId, practiceId)).orderBy(asc(users.name));
  const members = await db
    .select({ u: users, role: practiceMemberships.role })
    .from(practiceMemberships)
    .innerJoin(users, eq(users.id, practiceMemberships.userId))
    .where(and(eq(practiceMemberships.practiceId, practiceId), sql`${users.practiceId} <> ${practiceId}`))
    .orderBy(asc(users.name));
  return [
    ...home.map((u) => ({ userId: u.id, name: u.name, email: u.email, role: u.role, roleLabel: label(u.role), home: true, disabled: !!u.disabledAt, mfa: !!u.mfaSecret })),
    ...members.map(({ u, role }) => ({ userId: u.id, name: u.name, email: u.email, role, roleLabel: label(role), home: false, disabled: !!u.disabledAt, mfa: !!u.mfaSecret })),
  ];
}

/* ------------------------------ Custom roles ------------------------------ */

export async function listCustomRoles(db: Db, practiceId: string) {
  return db.select().from(customRoles).where(eq(customRoles.practiceId, practiceId)).orderBy(asc(customRoles.name));
}

export async function saveCustomRole(db: Db, practiceId: string, input: { name: string; baseRole: string; denied: string[] }, userId?: string) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error("Name the role");
  if (!(input.baseRole in BUILT_IN_ROLES)) throw new Error("Choose the role it starts from");
  if (Object.values(BUILT_IN_ROLES).some((l) => l.toLowerCase() === name.toLowerCase())) throw new Error("That name is a built-in role");
  const denied = [...new Set(input.denied)].filter((d) => CAPABILITIES.some((c) => c.key === d && c.roles.includes(input.baseRole)));
  const [row] = await db.insert(customRoles).values({ practiceId, name, baseRole: input.baseRole, denied }).onConflictDoUpdate({ target: [customRoles.practiceId, customRoles.name], set: { baseRole: input.baseRole, denied } }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "custom_role_saved", entity: "custom_role", entityId: row.id, details: { baseRole: input.baseRole, denied } });
  return row;
}

export async function deleteCustomRole(db: Db, practiceId: string, id: string, userId?: string) {
  const key = `custom:${id}`;
  const { rows } = await db.execute<{ n: string }>(sql`SELECT (SELECT count(*) FROM users WHERE role = ${key}) + (SELECT count(*) FROM practice_memberships WHERE role = ${key}) AS n`);
  if (Number(rows[0]?.n) > 0) throw new Error("Someone still has this role; give them another role first");
  await db.delete(customRoles).where(and(eq(customRoles.id, id), eq(customRoles.practiceId, practiceId)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "custom_role_deleted", entity: "custom_role", entityId: id });
}

async function validRole(db: Db, practiceId: string, role: string) {
  if (role in BUILT_IN_ROLES) return true;
  if (!role.startsWith("custom:")) return false;
  const [c] = await db.select({ id: customRoles.id }).from(customRoles).where(and(eq(customRoles.id, role.slice(7)), eq(customRoles.practiceId, practiceId))).limit(1);
  return !!c;
}

/** Built-in admin role, or a custom role built on it. */
async function isAdminRole(db: Db, practiceId: string, role: string) {
  if (role === "admin") return true;
  if (!role.startsWith("custom:")) return false;
  const [c] = await db.select({ base: customRoles.baseRole }).from(customRoles).where(and(eq(customRoles.id, role.slice(7)), eq(customRoles.practiceId, practiceId))).limit(1);
  return c?.base === "admin";
}

async function adminsLeft(db: Db, practiceId: string, excluding: string) {
  const team = await listTeam(db, practiceId);
  let n = 0;
  for (const m of team) if (m.userId !== excluding && !m.disabled && (await isAdminRole(db, practiceId, m.role))) n++;
  return n;
}

export async function setMemberRole(db: Db, practiceId: string, targetUserId: string, role: string, actorId?: string) {
  if (!(await validRole(db, practiceId, role))) throw new Error("Choose a role");
  const member = (await listTeam(db, practiceId)).find((m) => m.userId === targetUserId);
  if (!member) throw new Error("Not on this practice's team");
  if (!(await isAdminRole(db, practiceId, role)) && (await isAdminRole(db, practiceId, member.role)) && (await adminsLeft(db, practiceId, targetUserId)) === 0) {
    throw new Error("The practice needs at least one administrator");
  }
  // A membership row, if any, decides over the home role (see accessFor), so both change.
  if (member.home) await db.update(users).set({ role }).where(eq(users.id, targetUserId));
  await db.update(practiceMemberships).set({ role }).where(and(eq(practiceMemberships.userId, targetUserId), eq(practiceMemberships.practiceId, practiceId)));
  await db.insert(auditLog).values({ practiceId, userId: actorId ?? null, action: "role_changed", entity: "user", entityId: targetUserId, details: { from: member.role, to: role } });
}

/**
 * Takes away access. Someone whose home is this practice is deactivated (and
 * can be reactivated); someone with access from another practice loses the
 * membership. Their history stays.
 */
export async function setMemberActive(db: Db, practiceId: string, targetUserId: string, active: boolean, actorId?: string) {
  if (targetUserId === actorId && !active) throw new Error("You cannot deactivate yourself");
  const member = (await listTeam(db, practiceId)).find((m) => m.userId === targetUserId);
  if (!member) throw new Error("Not on this practice's team");
  if (!active && (await isAdminRole(db, practiceId, member.role)) && (await adminsLeft(db, practiceId, targetUserId)) === 0) throw new Error("The practice needs at least one administrator");
  if (member.home) await db.update(users).set({ disabledAt: active ? null : new Date() }).where(eq(users.id, targetUserId));
  else if (!active) await db.delete(practiceMemberships).where(and(eq(practiceMemberships.userId, targetUserId), eq(practiceMemberships.practiceId, practiceId)));
  await db.insert(auditLog).values({ practiceId, userId: actorId ?? null, action: active ? "user_reactivated" : "user_deactivated", entity: "user", entityId: targetUserId });
}

/* ------------------------------ Invites ------------------------------ */

const INVITE_AUDIENCE = "collaboratmd:invite";

/** A password nobody knows, for accounts that sign in by invite link or single sign-on. */
export async function unusablePassword() {
  return bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10);
}

/**
 * Adds someone to the team. A new person gets an account and a one-time link
 * to choose their password (valid 7 days, and only until it is used). Someone
 * who already has an account elsewhere gets access to this practice instead.
 */
export async function inviteMember(db: Db, practiceId: string, input: { name: string; email: string; role: string }, actorId?: string) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 120);
  if (!EMAIL.test(email)) throw new Error("Enter an email address");
  if (!name) throw new Error("Enter their name");
  if (!(await validRole(db, practiceId, input.role))) throw new Error("Choose a role");
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    if ((await listTeam(db, practiceId)).some((m) => m.userId === existing.id)) throw new Error("Already on the team");
    await db.insert(practiceMemberships).values({ userId: existing.id, practiceId, role: input.role });
    await db.insert(auditLog).values({ practiceId, userId: actorId ?? null, action: "member_added", entity: "user", entityId: existing.id, details: { role: input.role } });
    return { userId: existing.id, token: null };
  }
  const [u] = await db.insert(users).values({ practiceId, email, name, role: input.role, passwordHash: await unusablePassword() }).returning();
  await db.insert(auditLog).values({ practiceId, userId: actorId ?? null, action: "user_invited", entity: "user", entityId: u.id, details: { role: input.role } });
  return { userId: u.id, token: await inviteToken(u) };
}

/** Tied to the current password hash, so the link stops working once a password is set. */
async function inviteToken(u: { id: string; passwordHash: string }) {
  const pwv = crypto.createHash("sha256").update(u.passwordHash).digest("base64url").slice(0, 16);
  return new SignJWT({ userId: u.id, pwv }).setProtectedHeader({ alg: "HS256" }).setAudience(INVITE_AUDIENCE).setIssuedAt().setExpirationTime("7d").sign(appSecret());
}

export async function newInviteLink(db: Db, practiceId: string, userId: string) {
  const member = (await listTeam(db, practiceId)).find((m) => m.userId === userId && m.home);
  if (!member) throw new Error("Invite links are for people whose account belongs to this practice");
  // Once someone has chosen a password or signed in, a link would let an administrator take the account over.
  const [used] = await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.userId, userId), sql`${auditLog.action} IN ('invite_accepted', 'login')`)).limit(1);
  if (used) throw new Error("They have already signed in, so no new link is made: it would let whoever holds it set their password.");
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return inviteToken(u);
}

export async function readInvite(db: Db, token: string) {
  try {
    const { payload } = await jwtVerify(token, appSecret(), { audience: INVITE_AUDIENCE });
    const [u] = await db.select().from(users).where(eq(users.id, String(payload.userId))).limit(1);
    const pwv = u ? crypto.createHash("sha256").update(u.passwordHash).digest("base64url").slice(0, 16) : "";
    if (!u || u.disabledAt || payload.pwv !== pwv) return null;
    return u;
  } catch {
    return null;
  }
}

export async function acceptInvite(db: Db, token: string, password: string) {
  const u = await readInvite(db, token);
  if (!u) throw new Error("This link has expired or was already used. Ask your administrator for a new one.");
  if (password.length < 12) throw new Error("Use at least 12 characters");
  await db.update(users).set({ passwordHash: await bcrypt.hash(password, 10) }).where(eq(users.id, u.id));
  await db.insert(auditLog).values({ practiceId: u.practiceId, userId: u.id, action: "invite_accepted", entity: "user", entityId: u.id });
  return u.email;
}

/* ------------------------------ Sign-in policy ------------------------------ */

export const SESSION_HOURS = [1, 2, 4, 8, 12, 24];

export async function setSessionHours(db: Db, practiceId: string, hours: number, actorId?: string) {
  if (!SESSION_HOURS.includes(hours)) throw new Error("Choose a session length");
  await db.update(practices).set({ sessionHours: hours }).where(eq(practices.id, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: actorId ?? null, action: "session_policy_changed", entity: "practice", entityId: practiceId, details: { hours } });
}

/** Saves the allowlist, refusing one that would lock out the person saving it. */
export async function setIpAllowlist(db: Db, practiceId: string, raw: string, currentIp: string | null, actorId?: string) {
  const entries = [...new Set(raw.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean))];
  const bad = entries.find((e) => !parseCidr(e));
  if (bad) throw new Error(`"${bad}" is not an IP address or range (e.g. 203.0.113.0/24)`);
  if (entries.length > 50) throw new Error("Up to 50 entries");
  if (entries.length && !ipAllowed(currentIp, entries)) throw new Error(`Your own address (${currentIp ?? "unknown"}) is not in the list; saving it would sign you out. Add it first.`);
  await db.update(practices).set({ ipAllowlist: entries }).where(eq(practices.id, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: actorId ?? null, action: "ip_allowlist_changed", entity: "practice", entityId: practiceId, details: { entries: entries.length } });
  return entries;
}
