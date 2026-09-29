import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { b64url } from "@/lib/webauthn";
import { finishLogin, finishRegistration, listPasskeys, loginOptions, registrationOptions, removePasskey, siteFor } from "./passkeys";
import { mfaRule } from "./mfa-policy";

/* A software authenticator: what a phone or laptop does when it makes and uses a passkey. */

function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("unsupported");
}

class Authenticator {
  keys = generateKeyPairSync("ec", { namedCurve: "P-256" });
  id = Buffer.from("credential-0001");
  count = 0;
  constructor(public rpId: string, public origin: string) {}
  private authData(flags: number, extra = Buffer.alloc(0)) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.count);
    return Buffer.concat([createHash("sha256").update(this.rpId).digest(), Buffer.from([flags]), c, extra]);
  }
  create(challenge: string, origin = this.origin) {
    const jwk = (this.keys.publicKey as KeyObject).export({ format: "jwk" }) as { x: string; y: string };
    const cose = new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, b64url.decode(jwk.x)], [-3, b64url.decode(jwk.y)]]);
    const len = Buffer.from([this.id.length >> 8, this.id.length & 255]);
    const authData = this.authData(0x45, Buffer.concat([Buffer.alloc(16), len, this.id, cbor(cose)]));
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin }));
    return { attestationObject: b64url.encode(cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))), clientDataJSON: b64url.encode(clientDataJSON) };
  }
  get(challenge: string, opts: { origin?: string; flags?: number; count?: number } = {}) {
    this.count = opts.count ?? this.count + 1;
    const authData = this.authData(opts.flags ?? 0x05);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: opts.origin ?? this.origin }));
    const signature = sign("sha256", Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]), { key: this.keys.privateKey, dsaEncoding: "der" });
    return { id: b64url.encode(this.id), authenticatorData: b64url.encode(authData), clientDataJSON: b64url.encode(clientDataJSON), signature: b64url.encode(signature) };
  }
}

describe("passkeys", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  const site = siteFor("https://app.collaboratmd.test");
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("adds a passkey for the signed-in user, signs in with it, and counts it as two-factor", async () => {
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    const device = new Authenticator(site.rpId, site.origin);
    await t.db.update(schema.practices).set({ requireMfa: true }).where(eq(schema.practices.id, t.practiceId));
    expect((await mfaRule(t.db, { userId: user.id, practiceId: t.practiceId, role: user.role })).mustEnroll).toBe(!user.mfaSecret);

    const reg = await registrationOptions(t.db, user, site);
    expect(reg.publicKey.authenticatorSelection.userVerification).toBe("required");
    await finishRegistration(t.db, user.id, reg.challengeId, device.create(reg.publicKey.challenge), "Test laptop", site);
    expect((await listPasskeys(t.db, user.id)).map((k) => k.name)).toEqual(["Test laptop"]);
    expect((await mfaRule(t.db, { userId: user.id, practiceId: t.practiceId, role: user.role })).mustEnroll).toBe(false);

    const login = await loginOptions(t.db, site);
    const who = await finishLogin(t.db, login.challengeId, device.get(login.publicKey.challenge), site);
    expect(who.id).toBe(user.id);
    // The same challenge cannot be used twice.
    await expect(finishLogin(t.db, login.challengeId, device.get(login.publicKey.challenge), site)).rejects.toThrow(/expired/);
  });

  it("refuses a response for another site, without user verification, with a bad signature or a counter that went back", async () => {
    const [user] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    const device = new Authenticator(site.rpId, site.origin);
    device.id = Buffer.from("credential-0002");
    const reg = await registrationOptions(t.db, user, site);
    await expect(finishRegistration(t.db, user.id, reg.challengeId, device.create(reg.publicKey.challenge, "https://evil.test"), "x", site)).rejects.toThrow(/different site/);
    const reg2 = await registrationOptions(t.db, user, site);
    await finishRegistration(t.db, user.id, reg2.challengeId, device.create(reg2.publicKey.challenge), "Phone", site);

    const attempt = async (make: (challenge: string) => ReturnType<Authenticator["get"]>) => {
      const o = await loginOptions(t.db, site);
      return finishLogin(t.db, o.challengeId, make(o.publicKey.challenge), site);
    };
    await expect(attempt((c) => device.get(c, { origin: "https://evil.test" }))).rejects.toThrow(/different site/);
    await expect(attempt((c) => device.get(c, { flags: 0x01 }))).rejects.toThrow(/verify the person/);
    await expect(attempt((c) => ({ ...device.get(c), signature: b64url.encode(Buffer.from("not a signature")) }))).rejects.toThrow();
    expect((await attempt((c) => device.get(c, { count: 10 }))).id).toBe(user.id);
    await expect(attempt((c) => device.get(c, { count: 5 }))).rejects.toThrow(/copied/);

    await removePasskey(t.db, user.id, b64url.encode(device.id));
    await expect(attempt((c) => device.get(c, { count: 20 }))).rejects.toThrow(/not registered/);
  });
});
