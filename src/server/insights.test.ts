import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { looksLikePhi, parseQuestion, validateAiAnswer } from "./ask-data";
import { cashForecast, project } from "./forecast";
import { payerAlerts } from "./payer-alerts";

const payers = [{ id: "11111111-1111-4111-8111-111111111111", name: "Blue Cross Blue Shield of Texas" }, { id: "22222222-2222-4222-8222-222222222222", name: "Aetna" }];
const providers = [{ id: "33333333-3333-4333-8333-333333333333", name: "Johnson, Andre" }];

describe("ask your data", () => {
  it("maps common questions to a report without AI", () => {
    expect(parseQuestion("denials by reason for Aetna this quarter", payers, providers)).toMatchObject({ dataset: "denials", via: "keywords", config: { group: "category", range: "qtd", payerId: payers[1].id } });
    expect(parseQuestion("payments by month this year", payers, providers)?.config).toMatchObject({ group: "month", range: "ytd" });
    expect(parseQuestion("charges by CPT for Dr. Johnson last 90 days", payers, providers)).toMatchObject({ dataset: "charges", config: { group: "cpt", range: "90d", providerId: providers[0].id } });
    expect(parseQuestion("denied claims at Blue Cross Blue Shield of Texas", payers, providers)).toMatchObject({ dataset: "denials", config: { payerId: payers[0].id } });
    expect(parseQuestion("what's the weather", payers, providers)).toBeNull();
  });

  it("accepts an AI answer only inside the report builder's whitelist", () => {
    const a = validateAiAnswer({ dataset: "claims", columns: ["claim", "DROP TABLE", "billed"], group: "payer", range: "90d", status: "denied", payerId: payers[0].id, providerId: "not-a-provider", note: "x" }, payers, providers)!;
    expect(a.config).toEqual({ columns: ["claim", "billed"], group: "payer", range: "90d", status: "denied", payerId: payers[0].id, providerId: null });
    expect(validateAiAnswer({ dataset: "users" }, payers, providers)).toBeNull();
    expect(validateAiAnswer("nope", payers, providers)).toBeNull();
  });

  it("spots identifiers that should not leave without a BAA", () => {
    expect(looksLikePhi("balance for DOB 04/12/1961")).toBe(true);
    expect(looksLikePhi("member W123456789 claims")).toBe(true);
    expect(looksLikePhi("denials by payer last 90 days")).toBe(false);
  });
});

describe("cash forecast and payer alerts against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let payerId: string;
  let base: { patientId: string; encounterId: string; patientInsuranceId: string };
  let seq = 0;
  const DAY = 86_400_000;
  const now = new Date();

  beforeAll(async () => {
    t = await testDb();
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    base = { patientId: claim.patientId, encounterId: claim.encounterId, patientInsuranceId: claim.patientInsuranceId };
    [{ id: payerId }] = await t.db.insert(schema.payers).values({ practiceId: t.practiceId, name: "Forecast Test Health", payerId: "FTH01", type: "commercial" }).returning();
  });
  afterAll(async () => { await t?.close(); });

  async function claim(opts: { submittedDaysAgo: number; paidAfterDays?: number; paidCents?: number; deniedAfterDays?: number; carc?: string; status?: string; totalCents?: number }) {
    const total = opts.totalCents ?? 10_000;
    const submitted = new Date(now.getTime() - opts.submittedDaysAgo * DAY);
    const [c] = await t.db.insert(schema.claims).values({ practiceId: t.practiceId, ...base, payerId, controlNumber: `FC${++seq}`, totalCents: total, status: opts.status ?? "paid", submittedAt: submitted }).returning();
    if (opts.paidAfterDays !== undefined) {
      await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: base.patientId, claimId: c.id, type: "insurance_payment", amountCents: opts.paidCents ?? 8_000, postedAt: new Date(submitted.getTime() + opts.paidAfterDays * DAY) });
    }
    if (opts.deniedAfterDays !== undefined) {
      await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: c.id, category: "coding", carc: opts.carc ?? "50", amountCents: total, createdAt: new Date(submitted.getTime() + opts.deniedAfterDays * DAY) });
    }
    return c;
  }

  it("projects open claims from the payer's own lag history and flags ones older than any paid claim", async () => {
    for (let i = 0; i < 25; i++) await claim({ submittedDaysAgo: 200 + i, paidAfterDays: 14 });
    const before = (await cashForecast(t.db, t.practiceId, now)).stale;
    await claim({ submittedDaysAgo: 3, status: "submitted", totalCents: 100_000 });
    await claim({ submittedDaysAgo: 40, status: "pending", totalCents: 50_000 });
    const f = await cashForecast(t.db, t.practiceId, now);
    const p = f.payers.find((x) => x.payerId === payerId)!;
    expect(p).toMatchObject({ openClaims: 2, openCents: 150_000, medianLagDays: 14, ownHistory: true });
    expect(p.paidRatio).toBeCloseTo(0.8);
    // Submitted 3 days ago, pays at day 14: 11 days out, so the second week; 80% of $1,000.
    expect(p.weeks).toEqual([0, 80_000, 0, 0, 0, 0, 0, 0]);
    expect(f.stale).toEqual({ claims: before.claims + 1, cents: before.cents + 50_000 });
    expect(f.weekStarts).toHaveLength(8);
    expect(f.total[1]).toBe(f.insurance[1] + f.patient[1]);
  });

  it("discounts old unpaid claims by how rarely claims that old still paid", () => {
    const h = { lags: new Map([[10, 90], [40, 10]]), paidCount: 100, paidRatio: 1 };
    // At 20 days, only the 10 slow payers remain; with a 90% pay rate, P(paid | unpaid at 20) = 0.09 / (0.09 + 0.1).
    const w = project(h, 0.9, 20, 1_000)!;
    expect(w[2]).toBeCloseTo((1_000 * 0.09) / 0.19);
    expect(project(h, 0.9, 45, 1_000)).toBeNull();
  });

  it("alerts when a payer starts denying more, with a new reason", async () => {
    for (let i = 0; i < 25; i++) await claim({ submittedDaysAgo: 70 + i, paidAfterDays: 14 });
    for (let i = 0; i < 25; i++) {
      if (i < 10) await claim({ submittedDaysAgo: 20 + (i % 5), deniedAfterDays: 10, carc: "B7", status: "denied" });
      else await claim({ submittedDaysAgo: 20 + (i % 5), paidAfterDays: 12 });
    }
    const alerts = (await payerAlerts(t.db, t.practiceId, now)).filter((a) => a.payerId === payerId);
    expect(alerts.find((a) => a.kind === "denial_rate")).toMatchObject({ severity: "high", recent: 10 / 25, baseline: 0 });
    expect(alerts.find((a) => a.kind === "new_reason")?.title).toMatch(/B7/);
    expect(alerts.some((a) => a.kind === "slower")).toBe(false);
  });
});
