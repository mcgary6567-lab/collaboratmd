import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { mfaRefusal, mfaRule, privileged } from "./mfa-policy";

describe("who must use two-factor", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  const who = (role: string, extra: { denied?: string[]; sso?: boolean } = {}) => ({ userId: t.userId, practiceId: t.practiceId, role, ...extra });

  it("counts administrators and anyone whose role can export as privileged", () => {
    expect(privileged("admin")).toBe(true);
    expect(privileged("biller")).toBe(true);
    expect(privileged("readonly")).toBe(true);
    expect(privileged("front_desk")).toBe(false);
    // A custom role built on biller without exports.
    expect(privileged("biller", ["export"])).toBe(false);
  });

  it("asks privileged people only, when the practice says so, and never single sign-on users", async () => {
    expect(await mfaRule(t.db, who("admin"))).toMatchObject({ required: false, mustEnroll: false });
    await t.db.update(schema.practices).set({ mfaForPrivileged: true }).where(eq(schema.practices.id, t.practiceId));
    expect(await mfaRule(t.db, who("admin"))).toMatchObject({ required: true, why: "privileged", mustEnroll: true });
    expect(await mfaRule(t.db, who("front_desk"))).toMatchObject({ required: false, mustEnroll: false });
    expect(await mfaRule(t.db, who("admin", { sso: true }))).toMatchObject({ required: true, mustEnroll: false });
    expect((await mfaRefusal(t.db, who("biller")))?.status).toBe(403);
    expect(await mfaRefusal(t.db, who("front_desk"))).toBeNull();

    await t.db.update(schema.practices).set({ requireMfa: true }).where(eq(schema.practices.id, t.practiceId));
    expect(await mfaRule(t.db, who("front_desk"))).toMatchObject({ required: true, why: "everyone", mustEnroll: true });

    await t.db.update(schema.users).set({ mfaSecret: "sealed" }).where(eq(schema.users.id, t.userId));
    expect(await mfaRule(t.db, who("admin"))).toMatchObject({ required: true, enrolled: true, mustEnroll: false });
    expect(await mfaRefusal(t.db, who("admin"))).toBeNull();
  });
});
