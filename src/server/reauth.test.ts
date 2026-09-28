import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { codeAt, stepAt } from "@/lib/totp";
import { confirmEnrollment, MAX_FAILURES, startEnrollment } from "./mfa";
import { reauthenticate, reauthNeeds, RECENT_SSO_MINUTES } from "./reauth";

const key = new TextEncoder().encode("test-key-for-sealing-0123456789abcdef");
// The demo seed's administrator password (src/db/seed-data.ts).
const SEEDED_PASSWORD = "admin123";

describe("proving it is still the signed-in person", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  const who = () => ({ userId: t.userId, practiceId: t.practiceId });

  it("asks for the password, and counts a wrong one towards the lockout", async () => {
    expect(await reauthNeeds(t.db, t.userId, false)).toBe("password");
    await expect(reauthenticate(t.db, who(), { password: "not-it" }, key)).rejects.toThrow(/password is not right/);
    const [u] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    expect(u.failedLogins).toBe(1);
    expect(await t.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "reauth_failed"), eq(schema.auditLog.userId, t.userId)))).toHaveLength(1);

    await reauthenticate(t.db, who(), { password: SEEDED_PASSWORD }, key);
    const [after] = await t.db.select().from(schema.users).where(eq(schema.users.id, t.userId));
    expect(after.failedLogins).toBe(0);

    for (let i = 0; i < MAX_FAILURES - 1; i++) await expect(reauthenticate(t.db, who(), { password: "guess" }, key)).rejects.toThrow();
    await expect(reauthenticate(t.db, who(), { password: "guess" }, key)).rejects.toThrow(/locked/);
    // Locked: even the right password is refused until it expires.
    await expect(reauthenticate(t.db, who(), { password: SEEDED_PASSWORD }, key)).rejects.toThrow(/Try again in 15 minutes/);
    await t.db.update(schema.users).set({ lockedUntil: null, failedLogins: 0 }).where(eq(schema.users.id, t.userId));
  });

  it("asks for a current authenticator code when two-factor is on, not the password", async () => {
    const { secret } = await startEnrollment(t.db, t.userId, key);
    const now = Date.now();
    await confirmEnrollment(t.db, t.userId, codeAt(secret, stepAt(now)), key);
    expect(await reauthNeeds(t.db, t.userId, false)).toBe("code");
    await expect(reauthenticate(t.db, who(), { password: SEEDED_PASSWORD }, key)).rejects.toThrow(/code does not match/);
    await reauthenticate(t.db, who(), { code: codeAt(secret, stepAt(now) + 1) }, key);
  });

  it("for single sign-on without two-factor here, needs the identity provider to have checked the credentials just now", async () => {
    const [other] = await t.db.select().from(schema.users).where(and(eq(schema.users.practiceId, t.practiceId), eq(schema.users.role, "biller"))).limit(1);
    const sso = { userId: other.id, practiceId: t.practiceId, sso: true };
    expect(await reauthNeeds(t.db, other.id, true)).toBe("recent_sso");
    const now = new Date();
    const login = (at: Date, idpAuthAt?: Date) => t.db.insert(schema.auditLog).values({ practiceId: t.practiceId, userId: other.id, action: "login", entity: "user", entityId: other.id, at, details: idpAuthAt ? { sso: true, idpAuthAt: idpAuthAt.toISOString() } : { sso: true } });
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    await login(minutesAgo(RECENT_SSO_MINUTES + 5), minutesAgo(RECENT_SSO_MINUTES + 5));
    await expect(reauthenticate(t.db, sso, {}, key, now)).rejects.toThrow(/Sign in again/);
    // A new session a minute ago, but from the provider's remembered sign-in of hours ago: not enough.
    await login(minutesAgo(3), minutesAgo(300));
    await expect(reauthenticate(t.db, sso, {}, key, now)).rejects.toThrow(/Sign in again/);
    // A provider that does not say when it checked: not enough either.
    await login(minutesAgo(2));
    await expect(reauthenticate(t.db, sso, {}, key, now)).rejects.toThrow(/Sign in again/);
    await login(minutesAgo(1), minutesAgo(1));
    await reauthenticate(t.db, sso, {}, key, now);
  });
});
