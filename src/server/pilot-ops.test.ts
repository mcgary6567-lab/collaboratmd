import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { testDb } from "@/test/db";
import { listFeedback, resolveFeedback, submitFeedback } from "./feedback";
import { featureKey, recordUsage, usageSummary } from "./usage";
import { recordError } from "./errors";
import { schema } from "@/db";

describe("pilot operations", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => vi.unstubAllEnvs());

  it("takes a problem report and tells operators without quoting it", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "ops@example.com");
    const sent: string[] = [];
    const send = { email: async (to: string, subject: string, text: string) => { sent.push(`${subject}|${text}`); return true; }, sms: async () => true, webhook: async () => true };
    await expect(submitFeedback(t.db, { practiceId: t.practiceId, userId: t.userId, page: "/claims", message: "no" }, send)).rejects.toThrow(/few words/);
    const r = await submitFeedback(t.db, { practiceId: t.practiceId, userId: t.userId, page: "/claims/abc?q=Smith", message: "Submit button did nothing for Jane Doe's claim", userAgent: "UA", viewport: "1280x800", origin: "https://app.test" }, send);
    expect(r.page).toBe("/claims/abc");
    expect(sent[0]).toContain("new problem report");
    expect(sent[0]).not.toContain("Jane");
    expect((await listFeedback(t.db)).some((x) => x.report.id === r.id)).toBe(true);
    await resolveFeedback(t.db, r.id);
    expect((await listFeedback(t.db)).some((x) => x.report.id === r.id)).toBe(false);
  });

  it("counts page views by pattern, never by patient or claim", async () => {
    expect(featureKey("/claims/3f2a1b4c-1111-4111-8111-111111111111/edit?q=x")).toBe("claims/:id/edit");
    expect(featureKey("/patients/12345")).toBe("patients/:id");
    expect(featureKey("/api/usage")).toBeNull();
    expect(featureKey("/reports")).toBe("reports");
    const now = new Date("2026-10-01T12:00:00Z");
    await recordUsage(t.db, t.practiceId, "/claims", now);
    await recordUsage(t.db, t.practiceId, "/claims?status=denied", now);
    await recordUsage(t.db, t.practiceId, "/claims/3f2a1b4c-1111-4111-8111-111111111111", now);
    const s = await usageSummary(t.db, 30, now);
    expect(s.overall.find((u) => u.feature === "claims")).toMatchObject({ views: 2, practices: 1 });
    expect(s.top.get(t.practiceId)?.[0]).toEqual({ feature: "claims", views: 2 });
  });

  it("keeps the request id with an error, and ignores malformed ones", async () => {
    const fp = await recordError(t.db, { message: "Boom", path: "/x", method: "GET", requestId: "3f2a1b4c-2222-4222-8222-222222222222" });
    await recordError(t.db, { message: "Other", path: "/y", method: "GET", requestId: "<script>" });
    const rows = await t.db.select().from(schema.errorEvents);
    expect(rows.find((r) => r.fingerprint === fp)?.lastRequestId).toBe("3f2a1b4c-2222-4222-8222-222222222222");
    expect(rows.find((r) => r.message === "Other")?.lastRequestId).toBeNull();
  });
});
