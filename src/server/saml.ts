/**
 * SAML 2.0 single sign-on, for identity providers that do not offer OpenID
 * Connect (common in hospital systems: ADFS, older Okta and Ping setups).
 *
 * Built on @node-saml/node-saml, which verifies the XML signature against
 * the IdP certificate the practice saved, and checks the issuer, audience
 * (our entity ID), validity window and InResponseTo. Request IDs are kept in
 * the database rather than in memory, so a response is accepted only as the
 * answer to a request we sent, once, whichever server instance receives it.
 * Assertions must be signed.
 */
import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from "@node-saml/node-saml";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { SsoClaims, SsoConfig } from "./sso";

const { samlRequests } = schema;
const TEN_MINUTES = 10 * 60_000;

export const samlUrls = (origin: string, practiceId: string) => ({
  entityId: `${origin}/api/sso/saml/metadata/${practiceId}`,
  acs: `${origin}/api/sso/saml/acs/${practiceId}`,
});

/** Request IDs in the database: saved when the request is made, removed when its response is accepted. */
function dbCache(db: Db, practiceId: string): CacheProvider {
  return {
    async saveAsync(key) {
      await db.insert(samlRequests).values({ id: key, practiceId }).onConflictDoNothing();
      await db.delete(samlRequests).where(lt(samlRequests.createdAt, new Date(Date.now() - 24 * 3_600_000)));
      return { value: key, createdAt: Date.now() };
    },
    async getAsync(key) {
      const [row] = await db.select().from(samlRequests).where(and(eq(samlRequests.id, key), eq(samlRequests.practiceId, practiceId))).limit(1);
      // node-saml reads the cached value as the time the request was made.
      return row && Date.now() - row.createdAt.getTime() < TEN_MINUTES ? row.createdAt.toISOString() : null;
    },
    async removeAsync(key) {
      if (!key) return null;
      const [row] = await db.delete(samlRequests).where(eq(samlRequests.id, key)).returning();
      return row?.id ?? null;
    },
  };
}

/** A PEM or bare base64 certificate as the base64 body node-saml wants; throws if it is not an X.509 certificate. */
export function normalizeCert(input: string) {
  const body = input.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  try {
    new crypto.X509Certificate(Buffer.from(body, "base64"));
  } catch {
    throw new Error("The IdP certificate is not a valid X.509 certificate (paste the PEM from your identity provider)");
  }
  return body;
}

export function samlFor(db: Db, cfg: SsoConfig, origin: string) {
  if (cfg.protocol !== "saml" || !cfg.samlEntryPoint || !cfg.samlIdpCert) throw new Error("SAML is not set up for this practice");
  const urls = samlUrls(origin, cfg.practiceId);
  return new SAML({
    entryPoint: cfg.samlEntryPoint,
    issuer: urls.entityId,
    callbackUrl: urls.acs,
    audience: urls.entityId,
    idpCert: cfg.samlIdpCert,
    idpIssuer: cfg.samlIdpIssuer ?? undefined,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 60_000,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: TEN_MINUTES,
    cacheProvider: dbCache(db, cfg.practiceId),
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    disableRequestedAuthnContext: true,
  });
}

export async function samlLoginUrl(db: Db, cfg: SsoConfig, origin: string, loginHint: string) {
  return samlFor(db, cfg, origin).getAuthorizeUrlAsync("", undefined, { additionalParams: { login_hint: loginHint } });
}

/** The email the IdP asserted: an email attribute, or the NameID when it is an address. */
export function emailFromProfile(p: Profile) {
  const candidates = [p.email, p.mail, p["urn:oid:0.9.2342.19200300.100.1.3"], p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"], p.nameID];
  const email = candidates.find((v): v is string => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v));
  return email?.toLowerCase() ?? null;
}

/** Verifies a posted SAMLResponse and returns who it vouches for. */
export async function completeSaml(db: Db, cfg: SsoConfig, origin: string, samlResponse: string): Promise<SsoClaims> {
  const { profile } = await samlFor(db, cfg, origin).validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) throw new Error("The identity provider sent a logout, not a sign-in");
  const email = emailFromProfile(profile);
  if (!email) throw new Error("The identity provider did not send an email address. Map the user's email to the NameID or an email attribute.");
  if (!cfg.domains.includes(email.split("@")[1] ?? "")) throw new Error(`${email} is not in a domain this practice signs in with`);
  const first = typeof profile.firstName === "string" ? profile.firstName : typeof profile.givenName === "string" ? profile.givenName : "";
  const last = typeof profile.lastName === "string" ? profile.lastName : typeof profile.surname === "string" ? profile.surname : "";
  return { email, name: `${first} ${last}`.trim() || email, subject: profile.nameID };
}

export function spMetadata(db: Db, cfg: SsoConfig, origin: string) {
  return samlFor(db, cfg, origin).generateServiceProviderMetadata(null, null);
}
