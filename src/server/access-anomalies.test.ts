import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { accessAnomalies, accessLimits, chartsOpenedBy, flagReviews, LIMITS, notifyAccessAnomalies, reviewFlag, saveAccessLimits } from "./access-anomalies";
import { savePolicies } from "./policies";

describe("unusual chart access", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("flags someone who opens far more charts than usual, and tells administrators without naming patients", async () => {
    const now = new Date();
    const pats = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId));
    // A normal month: two charts a day.
    const earlier = [];
    for (let d = 2; d <= 30; d++) for (const p of pats.slice(0, 2)) earlier.push({ practiceId: t.practiceId, userId: t.userId, action: "patient_viewed", entity: "patient", entityId: p.id, details: { via: "chart" }, at: new Date(now.getTime() - d * 86_400_000) });
    await t.db.insert(schema.auditLog).values(earlier);
    expect((await accessAnomalies(t.db, t.practiceId, now)).find((a) => a.userId === t.userId)).toBeUndefined();

    // Today: every chart in the practice.
    await t.db.insert(schema.auditLog).values(pats.map((p) => ({ practiceId: t.practiceId, userId: t.userId, action: "patient_viewed", entity: "patient", entityId: p.id, details: { via: "chart" }, at: new Date(now.getTime() - 3_600_000) })));
    const me = (await accessAnomalies(t.db, t.practiceId, now)).find((a) => a.userId === t.userId)!;
    expect(me.charts).toBe(pats.length);
    expect(me.usualPerDay).toBeCloseTo(1.9, 0);
    expect(pats.length).toBeGreaterThanOrEqual(LIMITS.minForMultiple);
    expect(me.flagged).toBe(true);
    expect(me.why.join(" ")).toMatch(/usually about 2 a day/);

    expect(await notifyAccessAnomalies(t.db, t.practiceId, now)).toBe(1);
    expect(await notifyAccessAnomalies(t.db, t.practiceId, now)).toBe(1); // counted again, but the notification is not repeated
    const notes = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "access_anomaly"));
    expect(notes).toHaveLength(1);
    for (const p of pats) expect(`${notes[0].title} ${notes[0].body}`).not.toContain(p.lastName);

    expect((await chartsOpenedBy(t.db, t.practiceId, t.userId, now)).length).toBe(pats.length);
  });

  it("uses the practice's own limits, and keeps them when the billing policies are saved", async () => {
    const now = new Date();
    const pats = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId));
    await expect(saveAccessLimits(t.db, t.practiceId, { chartsPerDay: 2, multiple: 3, minForMultiple: 15, unrelatedPerDay: 10 }, t.userId)).rejects.toThrow(/between 5 and/);
    // A practice whose staff routinely open every chart: nothing today is unusual for it.
    const high = { chartsPerDay: 1000, multiple: 50, minForMultiple: 1000, unrelatedPerDay: 1000 };
    await saveAccessLimits(t.db, t.practiceId, high, t.userId);
    expect(await accessLimits(t.db, t.practiceId)).toEqual(high);
    expect((await accessAnomalies(t.db, t.practiceId, now)).find((a) => a.userId === t.userId)?.flagged).toBe(false);

    await savePolicies(t.db, t.practiceId, { strictScrub: true }, t.userId);
    expect(await accessLimits(t.db, t.practiceId)).toEqual(high);
    const [change] = await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "access_review_limits_changed"));
    expect(change.details).toMatchObject({ before: LIMITS, after: high });
    expect(pats.length).toBeGreaterThan(0);
  });

  it("records what a reviewer found, in the audit log", async () => {
    await expect(reviewFlag(t.db, t.practiceId, t.userId, { userId: t.userId, day: "2026-09-27", why: [] }, "ok")).rejects.toThrow(/few words/);
    await reviewFlag(t.db, t.practiceId, t.userId, { userId: t.userId, day: "2026-09-27", why: ["41 charts in a day"] }, "Asked: covering the front desk for the payer audit.");
    const [r] = await flagReviews(t.db, t.practiceId, 90);
    expect(r).toMatchObject({ userId: t.userId, day: "2026-09-27", why: ["41 charts in a day"], note: "Asked: covering the front desk for the payer audit." });
    expect(r.person).not.toBe("A former user");
    const [other] = await t.db.insert(schema.practices).values({ name: "Other", taxId: "1", npi: "1", address1: "1", city: "c", state: "FL", zip: "1" }).returning();
    await expect(reviewFlag(t.db, other.id, t.userId, { userId: t.userId, day: "2026-09-27", why: [] }, "Not in this practice")).rejects.toThrow(/not in this practice/);
  });
});
