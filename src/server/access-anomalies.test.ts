import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { accessAnomalies, chartsOpenedBy, LIMITS, notifyAccessAnomalies } from "./access-anomalies";

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
});
