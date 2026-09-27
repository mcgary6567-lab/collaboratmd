import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { RULES, applyRetention, retentionDays } from "./retention";

describe("data retention", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("keeps the audit log at least six years and refuses shorter settings", () => {
    const audit = RULES.find((r) => r.name === "AUDIT_LOG")!;
    expect(retentionDays(audit, {})).toBe(2555);
    expect(retentionDays(audit, { RETENTION_AUDIT_LOG_DAYS: "30" })).toBe(2555);
    expect(retentionDays(audit, { RETENTION_AUDIT_LOG_DAYS: "3650" })).toBe(3650);
  });

  it("deletes read notifications past their year and leaves recent and unread ones", async () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const old = new Date("2025-06-01T00:00:00Z");
    const rows = await t.db.insert(schema.notifications).values([
      { practiceId: t.practiceId, kind: "t", title: "old read", createdAt: old, readAt: old },
      { practiceId: t.practiceId, kind: "t", title: "old unread", createdAt: old },
      { practiceId: t.practiceId, kind: "t", title: "new read", createdAt: now, readAt: now },
    ]).returning();
    const before = await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.practiceId, t.practiceId));
    const r = await applyRetention(t.db, now);
    expect(r.NOTIFICATIONS).toBeGreaterThanOrEqual(1);
    const left = await t.db.select().from(schema.notifications);
    expect(left.some((n) => n.id === rows[0].id)).toBe(false);
    expect(left.some((n) => n.id === rows[1].id)).toBe(true);
    expect(left.some((n) => n.id === rows[2].id)).toBe(true);
    expect((await t.db.select().from(schema.auditLog).where(eq(schema.auditLog.practiceId, t.practiceId))).length).toBe(before.length);
  });
});
