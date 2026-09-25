import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { accessFor } from "@/lib/auth";
import { allows } from "@/lib/capabilities";
import { inCidr, ipAllowed, parseCidr } from "@/lib/ip";
import { acceptInvite, inviteMember, listTeam, readInvite, saveCustomRole, setIpAllowlist, setMemberActive, setMemberRole, setSessionHours } from "./team";
import { beginSso, completeSso, getSso, practiceForScimToken, rotateScimToken, saveSso, ssoForEmail, ssoUser } from "./sso";
import { createScimUser, deleteScimUser, listScimUsers, patchScimUser } from "./scim";

describe("IP allowlists", () => {
  it("matches IPv4 and IPv6 addresses against ranges", () => {
    expect(inCidr("203.0.113.77", "203.0.113.0/24")).toBe(true);
    expect(inCidr("203.0.114.1", "203.0.113.0/24")).toBe(false);
    expect(inCidr("10.1.2.3", "10.1.2.3")).toBe(true);
    expect(inCidr("::ffff:203.0.113.9", "203.0.113.0/24")).toBe(true);
    expect(inCidr("2001:db8::1", "2001:db8::/32")).toBe(true);
    expect(inCidr("2001:db9::1", "2001:db8::/32")).toBe(false);
    expect(inCidr("2001:db8::1", "203.0.113.0/24")).toBe(false);
    expect(parseCidr("203.0.113.0/33")).toBeNull();
    expect(parseCidr("not-an-ip")).toBeNull();
    expect(ipAllowed(null, [])).toBe(true);
    expect(ipAllowed(null, ["10.0.0.0/8"])).toBe(false);
  });

  it("lets a custom role only narrow its built-in role", () => {
    expect(allows("biller", [], "adjust")).toBe(true);
    expect(allows("biller", ["adjust"], "adjust")).toBe(false);
    expect(allows("front_desk", [], "adjust")).toBe(false);
    expect(allows("front_desk", [], "export")).toBe(false);
    expect(allows("readonly", [], "reports")).toBe(true);
  });
});

describe("team, roles, SSO and SCIM against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("resolves a custom role to its base with abilities switched off, and keeps an administrator", async () => {
    const team = await listTeam(t.db, t.practiceId);
    const biller = team.find((m) => m.role === "biller")!;
    const role = await saveCustomRole(t.db, t.practiceId, { name: "Coder", baseRole: "biller", denied: ["adjust", "export", "nonsense"] }, t.userId);
    expect(role.denied).toEqual(["adjust", "export"]);
    await setMemberRole(t.db, t.practiceId, biller.userId, `custom:${role.id}`, t.userId);
    expect(await accessFor(t.db, biller.userId, t.practiceId)).toMatchObject({ role: "biller", customRole: "Coder", denied: ["adjust", "export"], sessionHours: 12 });
    await expect(setMemberRole(t.db, t.practiceId, biller.userId, "superuser", t.userId)).rejects.toThrow(/Choose a role/);

    // The only administrator cannot be demoted or deactivated.
    const admins = team.filter((m) => m.role === "admin");
    for (const a of admins.slice(1)) await setMemberRole(t.db, t.practiceId, a.userId, "biller", t.userId);
    await expect(setMemberRole(t.db, t.practiceId, admins[0].userId, "biller", t.userId)).rejects.toThrow(/at least one administrator/);
    await expect(setMemberActive(t.db, t.practiceId, admins[0].userId, false, "someone-else")).rejects.toThrow(/at least one administrator/);
    await expect(setMemberActive(t.db, t.practiceId, t.userId, false, t.userId)).rejects.toThrow(/yourself/);

    await setMemberActive(t.db, t.practiceId, biller.userId, false, t.userId);
    expect(await accessFor(t.db, biller.userId, t.practiceId)).toBeNull();
    await setMemberActive(t.db, t.practiceId, biller.userId, true, t.userId);
    expect(await accessFor(t.db, biller.userId, t.practiceId)).not.toBeNull();
  });

  it("invites a new person with a one-time password link", async () => {
    const r = await inviteMember(t.db, t.practiceId, { name: "Nia Newhire", email: "Nia@Example.org", role: "front_desk" }, t.userId);
    expect(r.token).toBeTruthy();
    expect((await readInvite(t.db, r.token!))?.email).toBe("nia@example.org");
    await expect(acceptInvite(t.db, r.token!, "short")).rejects.toThrow(/12 characters/);
    expect(await acceptInvite(t.db, r.token!, "a-long-enough-passphrase")).toBe("nia@example.org");
    expect(await readInvite(t.db, r.token!)).toBeNull(); // used
    await expect(inviteMember(t.db, t.practiceId, { name: "Nia", email: "nia@example.org", role: "biller" })).rejects.toThrow(/Already on the team/);
  });

  it("refuses an allowlist that would lock out the admin saving it, and validates session length", async () => {
    await expect(setIpAllowlist(t.db, t.practiceId, "203.0.113.0/24", "198.51.100.7")).rejects.toThrow(/Your own address/);
    await expect(setIpAllowlist(t.db, t.practiceId, "203.0.113.0/24\nbogus", "203.0.113.5")).rejects.toThrow(/"bogus"/);
    expect(await setIpAllowlist(t.db, t.practiceId, "203.0.113.0/24, 2001:db8::/32", "203.0.113.5")).toEqual(["203.0.113.0/24", "2001:db8::/32"]);
    expect((await accessFor(t.db, t.userId, t.practiceId))?.ipAllowlist).toEqual(["203.0.113.0/24", "2001:db8::/32"]);
    await setIpAllowlist(t.db, t.practiceId, "", null);
    await expect(setSessionHours(t.db, t.practiceId, 7)).rejects.toThrow(/session length/);
    await setSessionHours(t.db, t.practiceId, 8);
    expect((await accessFor(t.db, t.userId, t.practiceId))?.sessionHours).toBe(8);
  });

  it("signs in through an OpenID Connect provider, checking nonce, audience and domain", async () => {
    const issuer = "https://idp.example-sso.test";
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
    const jwks = createLocalJWKSet({ keys: [jwk] });
    let idToken = "";
    let tokenRequest: { headers?: Record<string, string>; body?: string } | undefined;
    const http = async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      const body = url.endsWith("/.well-known/openid-configuration")
        ? { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys`, token_endpoint_auth_methods_supported: ["client_secret_basic"] }
        : (tokenRequest = init, { id_token: idToken, token_type: "Bearer" });
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    };
    await expect(saveSso(t.db, t.practiceId, { issuer: "http://insecure", clientId: "c", clientSecret: "s", domains: "x.org", enforce: false, autoProvision: false, defaultRole: "readonly" })).rejects.toThrow(/https/);
    await saveSso(t.db, t.practiceId, { issuer, clientId: "client-123", clientSecret: "shh", domains: "@SsoPractice.org", enforce: false, autoProvision: true, defaultRole: "front_desk" }, t.userId);
    const cfg = (await getSso(t.db, t.practiceId))!;
    expect(cfg.domains).toEqual(["ssopractice.org"]);
    expect((await ssoForEmail(t.db, "dr.who@ssopractice.org"))?.practiceId).toBe(t.practiceId);
    expect(await ssoForEmail(t.db, "dr.who@elsewhere.org")).toBeNull();

    const { url, pending } = await beginSso(cfg, "https://app.test/api/sso/callback", "dr.who@ssopractice.org", http);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${issuer}/authorize`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe(pending.state);

    const sign = (claims: Record<string, unknown>, aud = "client-123") => new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience(aud).setSubject("u-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    idToken = await sign({ email: "Dr.Who@ssopractice.org", email_verified: true, name: "Dr Who", nonce: pending.nonce });
    const claims = await completeSso(cfg, "code-1", "https://app.test/api/sso/callback", pending, { http, jwks });
    expect(claims).toEqual({ email: "dr.who@ssopractice.org", name: "Dr Who", subject: "u-1" });
    expect(tokenRequest?.headers?.Authorization).toBe(`Basic ${Buffer.from("client-123:shh").toString("base64")}`);
    expect(tokenRequest?.body).toContain(`code_verifier=${pending.verifier}`);

    idToken = await sign({ email: "dr.who@ssopractice.org", nonce: "someone-elses" });
    await expect(completeSso(cfg, "c", "r", pending, { http, jwks })).rejects.toThrow(/did not match/);
    idToken = await sign({ email: "dr.who@ssopractice.org", nonce: pending.nonce }, "another-client");
    await expect(completeSso(cfg, "c", "r", pending, { http, jwks })).rejects.toThrow();
    idToken = await sign({ email: "x@evil.org", nonce: pending.nonce });
    await expect(completeSso(cfg, "c", "r", pending, { http, jwks })).rejects.toThrow(/not in a domain/);
    idToken = await sign({ email: "dr.who@ssopractice.org", email_verified: false, nonce: pending.nonce });
    await expect(completeSso(cfg, "c", "r", pending, { http, jwks })).rejects.toThrow(/not verified/);

    const user = await ssoUser(t.db, cfg, claims);
    expect(user).toMatchObject({ email: "dr.who@ssopractice.org", role: "front_desk", practiceId: t.practiceId });
    expect((await ssoUser(t.db, cfg, claims)).id).toBe(user.id);
  });

  it("provisions and deprovisions people over SCIM with a hashed bearer token", async () => {
    const cfg = (await getSso(t.db, t.practiceId))!;
    const token = await rotateScimToken(t.db, t.practiceId, t.userId);
    expect(await practiceForScimToken(t.db, `Bearer ${token}`)).toMatchObject({ practiceId: t.practiceId });
    expect(await practiceForScimToken(t.db, "Bearer scim_wrong")).toBeNull();
    const [row] = await t.db.select().from(schema.practiceSso).where(eq(schema.practiceSso.practiceId, t.practiceId));
    expect(row.scimTokenHash).not.toContain(token);

    const base = "https://app.test/api/scim/v2";
    const created = await createScimUser(t.db, cfg, base, { userName: "Pat.Scim@ssopractice.org", name: { givenName: "Pat", familyName: "Scim" }, active: true });
    expect(created).toMatchObject({ userName: "pat.scim@ssopractice.org", displayName: "Pat Scim", active: true });
    await expect(createScimUser(t.db, cfg, base, { userName: "pat.scim@ssopractice.org" })).rejects.toMatchObject({ status: 409 });
    await expect(createScimUser(t.db, cfg, base, { userName: "pat@other.org" })).rejects.toMatchObject({ status: 400 });

    const found = await listScimUsers(t.db, cfg, base, { filter: 'userName eq "pat.scim@ssopractice.org"' });
    expect(found.totalResults).toBe(1);
    const off = await patchScimUser(t.db, cfg, base, created.id, { Operations: [{ op: "Replace", path: "active", value: false }] });
    expect(off.active).toBe(false);
    expect(await accessFor(t.db, created.id, t.practiceId)).toBeNull();
    const on = await patchScimUser(t.db, cfg, base, created.id, { Operations: [{ op: "replace", value: { active: true, displayName: "Pat Q. Scim" } }] });
    expect(on).toMatchObject({ active: true, displayName: "Pat Q. Scim" });
    await deleteScimUser(t.db, cfg, created.id);
    expect((await listScimUsers(t.db, cfg, base, { filter: 'userName eq "pat.scim@ssopractice.org"' })).Resources[0].active).toBe(false);
  });
});
