import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { auditEvents, evaluateControls, listVendors, practiceUsers, recordAccessReview, saveVendor } from "./compliance";
import { clearConfigCache, saveIntegration } from "./integrations";

describe("compliance center against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterEach(() => { vi.unstubAllEnvs(); clearConfigCache(); });
  afterAll(async () => { await t?.close(); });

  const status = async (key: string) => (await evaluateControls(t.db, t.practiceId)).find((c) => c.key === key)!;

  it("evaluates controls from the practice's real settings", async () => {
    expect((await status("mfa_required")).status).toBe("fail");
    await t.db.update(schema.practices).set({ requireMfa: true }).where(eq(schema.practices.id, t.practiceId));
    expect((await status("mfa_required")).status).toBe("pass");

    vi.stubEnv("AUTH_SECRET", "short");
    expect((await status("encryption_key")).status).toBe("fail");
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    expect((await status("encryption_key")).status).toBe("pass");

    expect((await status("access_review")).status).toBe("fail");
    const people = await practiceUsers(t.db, t.practiceId);
    const r = await recordAccessReview(t.db, t.practiceId, "Quarterly review", t.userId);
    expect(r.usersReviewed).toBe(people.length);
    expect((await status("access_review")).status).toBe("pass");
  });

  it("lists the vendors actually connected and tracks their BAAs", async () => {
    await saveIntegration(t.db, t.practiceId, "twilio", { enabled: true, settings: { accountSid: "AC" + "a".repeat(32), from: "+15125550100" }, secrets: { authToken: "b".repeat(32) } });
    const vendors = await listVendors(t.db, t.practiceId);
    const twilio = vendors.find((v) => v.vendor === "Twilio")!;
    expect(twilio).toMatchObject({ handlesPhi: true, baaStatus: "not_recorded" });
    expect(vendors.some((v) => v.vendor === "Stripe")).toBe(false); // not connected, not listed
    expect((await status("baa")).status).toBe("fail");

    await expect(saveVendor(t.db, t.practiceId, { id: twilio.id, vendor: "Twilio", service: "Texts", handlesPhi: true, baaStatus: "signed" })).rejects.toThrow(/date/);
    for (const v of (await listVendors(t.db, t.practiceId)).filter((x) => x.handlesPhi)) {
      await saveVendor(t.db, t.practiceId, { id: v.id, vendor: v.vendor, service: v.service, handlesPhi: true, baaStatus: "signed", signedOn: "2026-09-01", notes: "Filed in the compliance drive" }, t.userId);
    }
    expect((await status("baa")).status).toBe("pass");
  });

  it("filters the audit log and keeps practices apart", async () => {
    const reviews = await auditEvents(t.db, t.practiceId, { action: "access_review" });
    expect(reviews.length).toBe(1);
    expect(reviews[0].userName).toBeTruthy();
    expect(await auditEvents(t.db, "00000000-0000-0000-0000-000000000000")).toEqual([]);
  });
});
