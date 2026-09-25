/**
 * SCIM 2.0 (RFC 7643/7644) Users, so the practice's identity provider can add
 * people, update their names and turn access off when they leave.
 *
 * A SCIM user is anyone with access to the practice: an account whose home is
 * this practice, or one from another practice with a membership here.
 * Deactivating (active=false, or DELETE) disables a home account and removes
 * a membership; history is never deleted. Groups are not supported; roles are
 * managed in the Team page, and new people get the SSO default role.
 */
import { and, asc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { SsoConfig } from "./sso";
import { unusablePassword } from "./team";

const { users, practiceMemberships, auditLog } = schema;
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ScimError extends Error {
  constructor(public status: number, message: string, public scimType?: string) { super(message); }
}

export function scimError(status: number, detail: string, scimType?: string) {
  return { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: String(status), detail, ...(scimType ? { scimType } : {}) };
}

type U = typeof users.$inferSelect;

function resource(u: U, active: boolean, base: string) {
  const [given, ...rest] = u.name.split(" ");
  return {
    schemas: [USER_SCHEMA],
    id: u.id,
    userName: u.email,
    name: { formatted: u.name, givenName: given ?? "", familyName: rest.join(" ") },
    displayName: u.name,
    emails: [{ value: u.email, primary: true, type: "work" }],
    active,
    meta: { resourceType: "User", created: u.createdAt.toISOString(), location: `${base}/Users/${u.id}` },
  };
}

/** Users with access to the practice, with whether that access is active. */
async function scoped(db: Db, practiceId: string, where?: ReturnType<typeof eq>) {
  const rows = await db
    .select({ u: users, member: practiceMemberships.userId })
    .from(users)
    .leftJoin(practiceMemberships, and(eq(practiceMemberships.userId, users.id), eq(practiceMemberships.practiceId, practiceId)))
    .where(and(or(eq(users.practiceId, practiceId), sql`${practiceMemberships.userId} IS NOT NULL`), where))
    .orderBy(asc(users.createdAt));
  return rows.map((r) => ({ u: r.u, active: r.u.practiceId === practiceId ? !r.u.disabledAt : !!r.member && !r.u.disabledAt }));
}

export async function listScimUsers(db: Db, cfg: SsoConfig, base: string, q: { filter?: string | null; startIndex?: number; count?: number }) {
  let where: ReturnType<typeof eq> | undefined;
  if (q.filter) {
    const m = q.filter.match(/^\s*(userName|emails(?:\.value)?)\s+eq\s+"([^"]*)"\s*$/i);
    if (!m) throw new ScimError(400, "Only filters of the form userName eq \"...\" are supported", "invalidFilter");
    where = eq(users.email, m[2].toLowerCase());
  }
  const all = await scoped(db, cfg.practiceId, where);
  const start = Math.max(1, q.startIndex ?? 1);
  const count = Math.min(200, Math.max(0, q.count ?? 100));
  const page = all.slice(start - 1, start - 1 + count);
  return { schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"], totalResults: all.length, startIndex: start, itemsPerPage: page.length, Resources: page.map((r) => resource(r.u, r.active, base)) };
}

export async function getScimUser(db: Db, cfg: SsoConfig, base: string, id: string) {
  const [r] = await scoped(db, cfg.practiceId, eq(users.id, id));
  if (!r) throw new ScimError(404, "User not found");
  return resource(r.u, r.active, base);
}

type ScimUserInput = { userName?: string; name?: { givenName?: string; familyName?: string; formatted?: string }; displayName?: string; emails?: { value?: string; primary?: boolean }[]; active?: boolean };

function nameOf(body: ScimUserInput, fallback: string) {
  return (body.displayName || body.name?.formatted || [body.name?.givenName, body.name?.familyName].filter(Boolean).join(" ") || fallback).trim().slice(0, 120);
}

export async function createScimUser(db: Db, cfg: SsoConfig, base: string, body: ScimUserInput) {
  const email = (body.userName || body.emails?.find((e) => e.primary)?.value || body.emails?.[0]?.value || "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ScimError(400, "userName must be the person's email address", "invalidValue");
  if (!cfg.domains.includes(email.split("@")[1])) throw new ScimError(400, `${email} is not in a domain this practice signs in with`, "invalidValue");
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    const [r] = await scoped(db, cfg.practiceId, eq(users.id, existing.id));
    if (r) throw new ScimError(409, "A user with this userName already exists", "uniqueness");
    await db.insert(practiceMemberships).values({ userId: existing.id, practiceId: cfg.practiceId, role: cfg.defaultRole });
    await db.insert(auditLog).values({ practiceId: cfg.practiceId, action: "member_added", entity: "user", entityId: existing.id, details: { via: "scim" } });
    return getScimUser(db, cfg, base, existing.id);
  }
  const [u] = await db.insert(users).values({ practiceId: cfg.practiceId, email, name: nameOf(body, email), role: cfg.defaultRole, passwordHash: await unusablePassword(), disabledAt: body.active === false ? new Date() : null }).returning();
  await db.insert(auditLog).values({ practiceId: cfg.practiceId, userId: u.id, action: "user_provisioned", entity: "user", entityId: u.id, details: { via: "scim", role: cfg.defaultRole } });
  return getScimUser(db, cfg, base, u.id);
}

async function setActive(db: Db, cfg: SsoConfig, u: U, active: boolean) {
  if (u.practiceId === cfg.practiceId) {
    await db.update(users).set({ disabledAt: active ? null : u.disabledAt ?? new Date() }).where(eq(users.id, u.id));
  } else if (active) {
    await db.insert(practiceMemberships).values({ userId: u.id, practiceId: cfg.practiceId, role: cfg.defaultRole }).onConflictDoNothing();
  } else {
    await db.delete(practiceMemberships).where(and(eq(practiceMemberships.userId, u.id), eq(practiceMemberships.practiceId, cfg.practiceId)));
  }
  await db.insert(auditLog).values({ practiceId: cfg.practiceId, userId: u.id, action: active ? "user_reactivated" : "user_deactivated", entity: "user", entityId: u.id, details: { via: "scim" } });
}

async function owned(db: Db, cfg: SsoConfig, id: string) {
  const [r] = await scoped(db, cfg.practiceId, eq(users.id, id));
  if (!r) throw new ScimError(404, "User not found");
  return r;
}

/** PUT: replaces the name and active state. */
export async function replaceScimUser(db: Db, cfg: SsoConfig, base: string, id: string, body: ScimUserInput) {
  const r = await owned(db, cfg, id);
  // Only a home account's name is ours to change; a member from another practice keeps theirs.
  if (r.u.practiceId === cfg.practiceId) await db.update(users).set({ name: nameOf(body, r.u.name) }).where(eq(users.id, id));
  if (typeof body.active === "boolean" && body.active !== r.active) await setActive(db, cfg, r.u, body.active);
  return getScimUser(db, cfg, base, id);
}

/** PATCH with replace operations on active and name (what Okta and Entra send). */
export async function patchScimUser(db: Db, cfg: SsoConfig, base: string, id: string, body: { Operations?: { op?: string; path?: string; value?: unknown }[] }) {
  const r = await owned(db, cfg, id);
  let active: boolean | undefined;
  let name: string | undefined;
  for (const op of body.Operations ?? []) {
    if (!/^(replace|add)$/i.test(op.op ?? "")) continue;
    const values: Record<string, unknown> = op.path ? { [op.path]: op.value } : (op.value as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries(values)) {
      if (k === "active") active = v === true || v === "true" || v === "True";
      else if (k === "displayName" || k === "name.formatted") name = String(v);
    }
  }
  if (name && r.u.practiceId === cfg.practiceId) await db.update(users).set({ name: name.slice(0, 120) }).where(eq(users.id, id));
  if (active !== undefined && active !== r.active) await setActive(db, cfg, r.u, active);
  return getScimUser(db, cfg, base, id);
}

/** DELETE deactivates; history stays. */
export async function deleteScimUser(db: Db, cfg: SsoConfig, id: string) {
  const r = await owned(db, cfg, id);
  if (r.active) await setActive(db, cfg, r.u, false);
}

export const SERVICE_PROVIDER_CONFIG = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "The SCIM token from Settings, Single sign-on" }],
};
