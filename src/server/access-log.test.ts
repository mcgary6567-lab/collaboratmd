import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { patientAccessLog, recordView } from "./access-log";

describe("patient access log", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("records who opened a patient's records, once per 15 minutes per record", async () => {
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.patientId, p.id)).limit(1);
    const who = { practiceId: t.practiceId, userId: t.userId };
    const at = new Date("2026-10-01T15:00:00Z");
    expect(await recordView(t.db, who, p.id, "chart", undefined, at)).toBe(true);
    expect(await recordView(t.db, who, p.id, "chart", undefined, new Date(at.getTime() + 5 * 60_000))).toBe(false);
    expect(await recordView(t.db, who, p.id, "claim", claim.id, new Date(at.getTime() + 6 * 60_000))).toBe(true);
    expect(await recordView(t.db, who, p.id, "chart", undefined, new Date(at.getTime() + 20 * 60_000))).toBe(true);

    // What was done on the patient's claims shows too; other patients' activity does not.
    await t.db.insert(schema.auditLog).values({ practiceId: t.practiceId, userId: t.userId, action: "attachment_viewed", entity: "claim", entityId: claim.id, at: new Date(at.getTime() + 30 * 60_000) });
    const [other] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).offset(1).limit(1);
    await recordView(t.db, who, other.id, "chart", undefined, at);
    await t.db.insert(schema.auditLog).values({ practiceId: t.practiceId, userId: t.userId, action: "export", entity: "practice", entityId: t.practiceId, at: new Date(at.getTime() + 40 * 60_000) });

    const log = await patientAccessLog(t.db, t.practiceId, p.id);
    const mine = log.entries.filter((e) => e.at >= at);
    expect(mine.map((e) => e.what)).toEqual(["Opened a claim attachment", "Opened the chart", "Opened the claim", "Opened the chart"]);
    expect(mine.every((e) => e.who.length > 0)).toBe(true);
    expect(log.exports.some((x) => x.action === "export")).toBe(true);
    expect((await patientAccessLog(t.db, t.practiceId, other.id)).entries.some((e) => e.what === "Opened a claim attachment")).toBe(false);
  });
});
