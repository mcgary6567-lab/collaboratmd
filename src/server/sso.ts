/**
 * Single sign-on with OpenID Connect (Okta, Microsoft Entra ID, Google
 * Workspace, OneLogin, JumpCloud and others), one identity provider per
 * practice, plus the SCIM bearer token the provider uses to add and remove
 * people automatically (see scim.ts).
 *
 * The flow is the authorization code flow with PKCE: the browser is sent to
 * the provider with a random state, nonce and code challenge kept in a
 * short-lived signed cookie; the provider sends back a code, which the server
 * exchanges for an ID token, verified against the provider's published keys,
 * issuer, audience (our client ID), expiry and nonce. The email in it must be
 * verified and in one of the practice's domains.
 *
 * Built from the OpenID Connect Core and Discovery specifications and tested
 * against a simulated provider, not a live tenant.
 */
import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Db } from "@/db";
import { schema } from "@/db";
import { appSecret } from "@/lib/app-secret";
import { seal, unseal } from "@/lib/seal";
import { BUILT_IN_ROLES } from "@/lib/capabilities";
import { unusablePassword } from "./team";

const { practiceSso, users, practiceMemberships, auditLog } = schema;

export type SsoConfig = typeof practiceSso.$inferSelect;
export type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; token_endpoint_auth_methods_supported?: string[] };
type Http = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** The signed cookie that carries state, nonce and PKCE verifier between /api/sso/start and the callback. */
export const SSO_COOKIE = "collaboratmd_sso";
export const SSO_AUDIENCE = "collaboratmd:sso";

const DOMAIN = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

export async function getSso(db: Db, practiceId: string) {
  const [row] = await db.select().from(practiceSso).where(eq(practiceSso.practiceId, practiceId)).limit(1);
  return row ?? null;
}

export async function saveSso(db: Db, practiceId: string, input: { issuer: string; clientId: string; clientSecret?: string; domains: string; enforce: boolean; autoProvision: boolean; defaultRole: string }, userId?: string) {
  const issuer = input.issuer.trim().replace(/\/$/, "");
  if (!/^https:\/\/[^\s/]+/.test(issuer)) throw new Error("The issuer must be an https address, e.g. https://yourcompany.okta.com");
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error("Enter the client ID");
  const domains = [...new Set(input.domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];
  if (!domains.length) throw new Error("Add at least one email domain, e.g. yourpractice.com");
  const bad = domains.find((d) => !DOMAIN.test(d));
  if (bad) throw new Error(`"${bad}" is not a domain`);
  const { rows: taken } = await db.execute<{ practice_id: string }>(sql`SELECT practice_id FROM practice_sso WHERE practice_id <> ${practiceId} AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(domains) d WHERE d = ANY (string_to_array(${domains.join(",")}, ','))) LIMIT 1`);
  if (taken.length) throw new Error("One of those domains already signs in to another practice");
  if (!(input.defaultRole in BUILT_IN_ROLES)) throw new Error("Choose the role for people added automatically");
  const existing = await getSso(db, practiceId);
  const secret = input.clientSecret?.trim();
  if (!secret && !existing) throw new Error("Enter the client secret");
  const values = {
    issuer, clientId, domains, enforce: input.enforce, autoProvision: input.autoProvision, defaultRole: input.defaultRole,
    clientSecretSealed: secret ? seal(secret, appSecret()) : existing!.clientSecretSealed, updatedBy: userId ?? null, updatedAt: new Date(),
  };
  await db.insert(practiceSso).values({ practiceId, ...values }).onConflictDoUpdate({ target: practiceSso.practiceId, set: values });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "sso_saved", entity: "practice", entityId: practiceId, details: { issuer, domains, enforce: input.enforce, autoProvision: input.autoProvision } });
}

export async function removeSso(db: Db, practiceId: string, userId?: string) {
  await db.delete(practiceSso).where(eq(practiceSso.practiceId, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "sso_removed", entity: "practice", entityId: practiceId });
}

/** The practice whose identity provider signs in this email address. */
export async function ssoForEmail(db: Db, email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return null;
  const [row] = await db.select().from(practiceSso).where(sql`${practiceSso.domains} ? ${domain}`).limit(1);
  return row ?? null;
}

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();

/** The provider's /.well-known/openid-configuration, cached for an hour. */
export async function discover(issuer: string, http: Http = fetch as unknown as Http): Promise<Discovery> {
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.doc;
  const res = await http(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`The identity provider's discovery document returned ${res.status}. Check the issuer address.`);
  const doc = (await res.json()) as Discovery;
  if (doc.issuer?.replace(/\/$/, "") !== issuer) throw new Error(`The provider says its issuer is ${doc.issuer}, not ${issuer}. Use exactly that address.`);
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (!doc[k] || !String(doc[k]).startsWith("https://")) throw new Error(`The discovery document has no https ${k}`);
  }
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

const b64url = (b: Buffer) => b.toString("base64url");

/** The OpenID Connect settings of a practice's SSO, or an error if it uses SAML or is incomplete. */
export function oidc(cfg: SsoConfig) {
  if (cfg.protocol !== "oidc" || !cfg.issuer || !cfg.clientId || !cfg.clientSecretSealed) throw new Error("This practice signs in with SAML, not OpenID Connect");
  return { ...cfg, issuer: cfg.issuer, clientId: cfg.clientId, clientSecretSealed: cfg.clientSecretSealed };
}

/** Where to send the browser, and what to remember (in a signed cookie) until it comes back. */
export async function beginSso(sso: SsoConfig, redirectUri: string, loginHint: string, http?: Http) {
  const cfg = oidc(sso);
  const doc = await discover(cfg.issuer, http);
  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code", client_id: cfg.clientId, redirect_uri: redirectUri, scope: "openid email profile",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256", login_hint: loginHint,
  }).toString();
  return { url: url.toString(), pending: { practiceId: cfg.practiceId, state, nonce, verifier } };
}

export type SsoClaims = { email: string; name: string; subject: string };

/** Exchanges the code and verifies the ID token. */
export async function completeSso(sso: SsoConfig, code: string, redirectUri: string, pending: { nonce: string; verifier: string }, deps: { http?: Http; jwks?: JWTVerifyGetKey } = {}): Promise<SsoClaims> {
  const http = deps.http ?? (fetch as unknown as Http);
  const cfg = oidc(sso);
  const doc = await discover(cfg.issuer, http);
  const secret = unseal(cfg.clientSecretSealed, appSecret());
  const methods = doc.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  const basic = methods.includes("client_secret_basic") || !methods.includes("client_secret_post");
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: pending.verifier });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(secret)}`).toString("base64")}`;
  else { body.set("client_id", cfg.clientId); body.set("client_secret", secret); }
  const res = await http(doc.token_endpoint, { method: "POST", headers, body: body.toString() });
  if (!res.ok) throw new Error(`The identity provider refused the sign-in (${res.status}). Check the client ID, secret and redirect address.`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("The identity provider returned no ID token");
  const jwks = deps.jwks ?? createRemoteJWKSet(new URL(doc.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer: doc.issuer, audience: cfg.clientId, clockTolerance: 60 });
  if (payload.nonce !== pending.nonce) throw new Error("The sign-in response did not match this browser's request");
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) throw new Error("The identity provider did not send an email address. Add the email claim to the app's token.");
  if (payload.email_verified === false) throw new Error("The identity provider says this email address is not verified");
  if (!cfg.domains.includes(email.split("@")[1] ?? "")) throw new Error(`${email} is not in a domain this practice signs in with`);
  const name = typeof payload.name === "string" && payload.name ? payload.name : [payload.given_name, payload.family_name].filter((x) => typeof x === "string").join(" ") || email;
  return { email, name, subject: String(payload.sub) };
}

/**
 * The account for a verified SSO identity: an existing user with access to
 * the practice, or (when the practice allows it) a new one with the default
 * role. Someone deactivated stays out.
 */
export async function ssoUser(db: Db, cfg: SsoConfig, claims: SsoClaims) {
  const [existing] = await db.select().from(users).where(eq(users.email, claims.email)).limit(1);
  if (existing) {
    if (existing.disabledAt) throw new Error("This account has been deactivated. Ask your practice administrator.");
    const member = existing.practiceId === cfg.practiceId || (await db.select().from(practiceMemberships).where(and(eq(practiceMemberships.userId, existing.id), eq(practiceMemberships.practiceId, cfg.practiceId))).limit(1)).length > 0;
    if (member) return existing;
    if (!cfg.autoProvision) throw new Error("Your account does not have access to this practice. Ask an administrator to add you.");
    await db.insert(practiceMemberships).values({ userId: existing.id, practiceId: cfg.practiceId, role: cfg.defaultRole });
    await db.insert(auditLog).values({ practiceId: cfg.practiceId, userId: existing.id, action: "member_added", entity: "user", entityId: existing.id, details: { via: "sso", role: cfg.defaultRole } });
    return existing;
  }
  if (!cfg.autoProvision) throw new Error("No account exists for this address. Ask an administrator to add you, or to turn on automatic accounts for single sign-on.");
  const [u] = await db.insert(users).values({ practiceId: cfg.practiceId, email: claims.email, name: claims.name.slice(0, 120), role: cfg.defaultRole, passwordHash: await unusablePassword() }).returning();
  await db.insert(auditLog).values({ practiceId: cfg.practiceId, userId: u.id, action: "user_provisioned", entity: "user", entityId: u.id, details: { via: "sso", role: cfg.defaultRole } });
  return u;
}

/* ------------------------------ SCIM token ------------------------------ */

const scimHash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

/** A new SCIM bearer token, shown once; only its hash is kept. Replaces any earlier one. */
export async function rotateScimToken(db: Db, practiceId: string, userId?: string) {
  if (!(await getSso(db, practiceId))) throw new Error("Set up single sign-on first");
  const token = `scim_${b64url(crypto.randomBytes(32))}`;
  await db.update(practiceSso).set({ scimTokenHash: scimHash(token), scimTokenHint: token.slice(-4) }).where(eq(practiceSso.practiceId, practiceId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "scim_token_rotated", entity: "practice", entityId: practiceId });
  return token;
}

export async function practiceForScimToken(db: Db, authorization: string | null) {
  const token = authorization?.match(/^Bearer\s+(scim_[\w-]+)$/)?.[1];
  if (!token) return null;
  const [row] = await db.select().from(practiceSso).where(eq(practiceSso.scimTokenHash, scimHash(token))).limit(1);
  return row ?? null;
}
