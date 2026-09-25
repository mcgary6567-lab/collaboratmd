import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { isDue, normalizeConfig, rangeStart, runReport, saveReport, sendScheduledReports } from "./report-builder";

describe("report builder", () => {
  it("keeps configs to the dataset's whitelist", () => {
    const c = normalizeConfig("claims", { columns: ["claim", "drop table", "billed"], group: "nope", range: "bogus", status: "paid; --", payerId: "x" });
    expect(c).toEqual({ columns: ["claim", "billed"], group: null, range: "30d", payerId: null, providerId: null, status: null });
    expect(() => normalizeConfig("secrets", {})).toThrow(/Unknown dataset/);
  });

  it("works out date ranges and when schedules are due", () => {
    const now = new Date("2026-09-24T12:00:00Z"); // a Thursday
    expect(rangeStart("mtd", now)?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(rangeStart("qtd", now)?.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(rangeStart("all", now)).toBeNull();
    expect(isDue("weekly", null, now)).toBe(false);
    expect(isDue("weekly", null, new Date("2026-09-28T12:00:00Z"))).toBe(true);
    expect(isDue("weekly", new Date("2026-09-28T01:00:00Z"), new Date("2026-09-28T12:00:00Z"))).toBe(false);
    expect(isDue("monthly", null, new Date("2026-10-01T12:00:00Z"))).toBe(true);
  });
});

describe("report builder against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let other: string;
  beforeAll(async () => {
    t = await testDb();
    const [p] = await t.db.insert(schema.practices).values({ name: "Other", taxId: "11-1111111", npi: "1234567893", address1: "1", city: "A", state: "TX", zip: "78701" }).returning();
    other = p.id;
  });
  afterAll(async () => { await t?.close(); });

  it("returns rows with totals, and groups with counts and sums", async () => {
    const rows = await runReport(t.db, t.practiceId, "claims", { columns: ["claim", "payer", "billed"], range: "all" });
    expect(rows.headers.map((h) => h.key)).toEqual(["claim", "payer", "billed"]);
    expect(rows.rowCount).toBeGreaterThan(0);
    expect(rows.totals.billed).toBe(rows.rows.reduce((a, r) => a + Number(r.billed), 0));

    const grouped = await runReport(t.db, t.practiceId, "claims", { columns: ["billed"], group: "payer", range: "all" });
    expect(grouped.headers.map((h) => h.key)).toEqual(["group", "count", "billed"]);
    const [{ n }] = await t.db.execute<{ n: string }>(`SELECT count(*)::int AS n FROM claims WHERE practice_id = '${t.practiceId}'`).then((r) => r.rows);
    expect(grouped.totals.count).toBe(Number(n));

    for (const ds of ["denials", "payments", "charges"]) {
      const r = await runReport(t.db, t.practiceId, ds, { range: "all" });
      expect(r.headers.length).toBeGreaterThan(0);
    }
    expect((await runReport(t.db, other, "claims", { range: "all" })).rowCount).toBe(0);
  });

  it("saves reports, validates recipients, and emails totals without patient details", async () => {
    await expect(saveReport(t.db, t.practiceId, { name: "x", dataset: "claims", config: {}, schedule: "weekly", recipients: [] })).rejects.toThrow(/recipient/);
    await expect(saveReport(t.db, t.practiceId, { name: "x", dataset: "claims", config: {}, schedule: "none", recipients: ["not-an-email"] })).rejects.toThrow(/not an email/);
    const r = await saveReport(t.db, t.practiceId, { name: "Claims by patient", dataset: "claims", config: { columns: ["patient", "billed"], range: "all" }, schedule: "weekly", recipients: ["Owner@Example.com", "owner@example.com"] }, t.userId);
    expect(r.recipients).toEqual(["owner@example.com"]);
    const [patient] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);

    const mails: { to: string; text: string }[] = [];
    const send = async (to: string, _s: string, text: string) => { mails.push({ to, text }); return true; };
    const monday = new Date("2026-09-28T13:00:00Z");
    const res = await sendScheduledReports(t.db, t.practiceId, "https://site.test", send, monday);
    expect(res).toEqual({ due: 1, sent: 1 });
    expect(mails[0].to).toBe("owner@example.com");
    expect(mails[0].text).toContain(`https://site.test/reports/builder?id=${r.id}`);
    expect(mails[0].text).not.toContain(patient.lastName);
    expect((await sendScheduledReports(t.db, t.practiceId, "https://site.test", send, monday)).due).toBe(0); // not twice
  });
});
