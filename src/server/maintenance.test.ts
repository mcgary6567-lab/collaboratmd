import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { alertStaleCodeSets, codeSetCalendar, fiscalYear, releaseDates, setStatus } from "./code-set-calendar";
import { certificateExpiry, practiceMaintenance, runtimeStatus } from "./maintenance";
import { runDailyChecks } from "./daily-checks";
import { X12 } from "@/lib/edi/standards";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const QUARTERLY: [number, number][] = [[1, 1], [4, 1], [7, 1], [10, 1]];

describe("the release calendar", () => {
  it("finds the release in effect and the next one", () => {
    const r = releaseDates(QUARTERLY, d("2026-10-01"));
    expect([r.current.toISOString().slice(0, 10), r.next.toISOString().slice(0, 10)]).toEqual(["2026-10-01", "2027-01-01"]);
    const y = releaseDates([[10, 1]], d("2026-09-30"));
    expect([y.current.toISOString().slice(0, 10), y.next.toISOString().slice(0, 10)]).toEqual(["2025-10-01", "2026-10-01"]);
    expect([fiscalYear(d("2026-09-30")), fiscalYear(d("2026-10-01"))]).toEqual([2026, 2027]);
  });

  it("calls a set current, due, overdue or never loaded", () => {
    const ncci = { effective: QUARTERLY, publishedDaysBefore: 30 };
    expect(setStatus(ncci, null, d("2026-11-10")).status).toBe("never");
    expect(setStatus(ncci, d("2026-09-20"), d("2026-11-10")).status).toBe("current"); // October's file, published in September
    expect(setStatus(ncci, d("2026-08-01"), d("2026-11-10")).status).toBe("overdue"); // only July's file
    expect(setStatus(ncci, d("2026-09-20"), d("2026-12-10")).status).toBe("due"); // January's file is out, not loaded
    expect(setStatus(ncci, d("2026-12-05"), d("2026-12-10")).status).toBe("current");
  });
});

describe("the runtime and certificates", () => {
  it("knows how long the Node.js line has left", () => {
    expect(runtimeStatus("v24.9.0", d("2026-10-01")).status).toBe("ok");
    expect(runtimeStatus("v24.9.0", d("2027-12-01")).status).toBe("soon");
    expect(runtimeStatus("v20.18.0", d("2026-10-01")).status).toBe("attention");
    expect(runtimeStatus("v31.0.0", d("2026-10-01")).status).toBe("soon");
  });

  it("reads a certificate's expiry", () => {
    const pem = fs.readFileSync(path.join(__dirname, "../test/fixtures/idp-test-cert.pem"), "utf8");
    expect(certificateExpiry(pem)?.toISOString().slice(0, 10)).toBe("2036-09-28");
    expect(certificateExpiry("not a certificate")).toBeNull();
  });

  it("keeps every X12 guide in one registry", () => {
    expect(X12["837P"].guide).toBe("005010X222A1");
    expect(Object.values(X12).every((v) => /^005010X\d{3}/.test(v.guide))).toBe(true);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("lists code sets against the calendar and tells operators at most weekly", async () => {
    await t.db.insert(schema.codeSetLoads).values([
      { codeSet: "ncci_ptp", label: "Q4 2026", rows: 10, createdAt: d("2026-09-20") },
      { codeSet: "ncci_mue", label: "Q3 2026", rows: 10, createdAt: d("2026-06-20") },
    ]);
    const rows = await codeSetCalendar(t.db, d("2026-11-10"));
    const by = new Map(rows.map((r) => [r.set, r.status]));
    expect(by.get("ncci_ptp")).toBe("current");
    expect(by.get("ncci_mue")).toBe("overdue");
    expect(by.get("telehealth")).toBe("never");
    const sent: string[] = [];
    const alert = async (subject: string, text: string) => { sent.push(`${subject}\n${text}`); };
    expect(await alertStaleCodeSets(t.db, alert, d("2026-11-10"))).toMatchObject({ sent: true });
    expect(sent[0]).toMatch(/OVERDUE: NCCI medically unlikely edits/);
    expect(await alertStaleCodeSets(t.db, alert, d("2026-11-12"))).toMatchObject({ sent: false, reason: "sent this week" });
    expect(await alertStaleCodeSets(t.db, alert, d("2026-11-18"))).toMatchObject({ sent: true });
    expect(sent).toHaveLength(2);
  });

  it("lists what in the practice's setup goes stale, and notifies once a month", async () => {
    const now = d("2026-10-01");
    const [active] = await t.db.select({ id: schema.feeSchedules.id }).from(schema.feeSchedules).limit(1);
    if (!active) await t.db.insert(schema.feeSchedules).values({ practiceId: t.practiceId, name: "Standard charges" });
    let items = await practiceMaintenance(t.db, t.practiceId, now);
    const fees = items.find((i) => i.key === "fees");
    expect(fees?.status).toBe("attention"); // never changed since setup, and it is past March
    expect(fees?.detail).toMatch(/this year's Medicare rates/);
    expect((await practiceMaintenance(t.db, t.practiceId, d("2027-01-20"))).find((i) => i.key === "fees")?.status).toBe("soon");
    await t.db.insert(schema.auditLog).values({ practiceId: t.practiceId, userId: t.userId, action: "save_fee_schedule", entity: "fee_schedule", entityId: t.practiceId, at: d("2026-02-03") });
    items = await practiceMaintenance(t.db, t.practiceId, now);
    expect(items.find((i) => i.key === "fees")?.status).toBe("ok");

    await t.db.insert(schema.apiKeys).values({ practiceId: t.practiceId, name: "Old integration", prefix: "cmd_old", keyHash: "hash-old-key-for-test", createdAt: d("2025-06-01"), lastUsedAt: d("2026-09-29") });
    items = await practiceMaintenance(t.db, t.practiceId, now);
    expect(items.find((i) => i.key === "api-keys")).toMatchObject({ status: "soon" });
    expect(items.find((i) => i.key === "api-keys")?.detail).toMatch(/older than a year/);

    const pem = fs.readFileSync(path.join(__dirname, "../test/fixtures/idp-test-cert.pem"), "utf8");
    await t.db.insert(schema.practiceSso).values({ practiceId: t.practiceId, protocol: "saml", samlIdpCert: pem });
    expect((await practiceMaintenance(t.db, t.practiceId, now)).find((i) => i.key === "saml")?.status).toBe("ok");
    expect((await practiceMaintenance(t.db, t.practiceId, d("2036-09-10"))).find((i) => i.key === "saml")?.status).toBe("soon");
    expect((await practiceMaintenance(t.db, t.practiceId, d("2036-10-10"))).find((i) => i.key === "saml")?.status).toBe("attention");

    const first = await runDailyChecks(t.db, t.practiceId, now);
    expect(first.maintenance).toBeGreaterThanOrEqual(1);
    const before = (await t.db.select().from(schema.notifications)).filter((n) => n.kind === "maintenance").length;
    await runDailyChecks(t.db, t.practiceId, d("2026-10-02"));
    expect((await t.db.select().from(schema.notifications)).filter((n) => n.kind === "maintenance").length).toBe(before);
  });
});
