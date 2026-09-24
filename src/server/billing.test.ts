import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import {
  applyDiscount, buildStatementDetail, createEstimate, createPaymentPlan, ensureDefaultPolicies, generateStatement,
  generateStatementBatch, getPlan, listPolicies, patientBalanceCents, recordPlanPayment, refreshPlanStatuses,
} from "./billing";
import { contractFromPercent } from "./fees";
import { addMonths } from "@/lib/billing/plans";

let t: Awaited<ReturnType<typeof testDb>>;
let patientId: string;
let claimId: string;

beforeAll(async () => {
  t = await testDb();
  // A patient with a known $300.00 responsibility on one claim.
  const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
  claimId = claim.id;
  patientId = claim.patientId;
  await t.db.delete(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.patientId, patientId), eq(schema.ledgerEntries.type, "patient_payment")));
  const current = await patientBalanceCents(t.db, patientId);
  await t.db.insert(schema.ledgerEntries).values({
    practiceId: t.practiceId, patientId, claimId, type: "transfer_to_patient", amountCents: 30_000 - current, groupCode: "PR", reasonCode: "1", note: "Deductible",
  });
});
afterAll(async () => { await t?.close(); });

describe("patient balance and discounts", () => {
  it("reads the balance from the ledger", async () => {
    expect(await patientBalanceCents(t.db, patientId)).toBe(30_000);
  });

  it("posts a discount as its own ledger entry and reduces the balance", async () => {
    await ensureDefaultPolicies(t.db, t.practiceId);
    const policies = await listPolicies(t.db, t.practiceId);
    expect(policies.map((p) => p.kind).sort()).toEqual(["hardship", "prompt_pay", "self_pay"]);
    const promptPay = policies.find((p) => p.kind === "prompt_pay")!;
    const entry = await applyDiscount(t.db, t.practiceId, patientId, promptPay.id);
    expect(entry.type).toBe("discount");
    expect(entry.amountCents).toBe(3_000);
    expect(await patientBalanceCents(t.db, patientId)).toBe(27_000);
  });

  it("refuses to discount across practices", async () => {
    const [p] = await listPolicies(t.db, t.practiceId);
    await expect(applyDiscount(t.db, "00000000-0000-0000-0000-000000000000", patientId, p.id)).rejects.toThrow();
  });
});

describe("statements", () => {
  it("itemizes the owing visit and bills the whole balance", async () => {
    const d = await buildStatementDetail(t.db, patientId);
    expect(d.visits.some((v) => v.claimId === claimId)).toBe(true);
    const visit = d.visits.find((v) => v.claimId === claimId)!;
    expect(visit.services.length).toBeGreaterThan(0);
    expect(d.totals.amountDueCents).toBe(await patientBalanceCents(t.db, patientId));
  });

  it("generates numbered statements and a rerun skips recently billed patients", async () => {
    const st = await generateStatement(t.db, t.practiceId, patientId);
    expect(st.statementNumber).toMatch(/^S\d{8}-0001$/);
    expect(st.amountDueCents).toBe(27_000);
    const batch = await generateStatementBatch(t.db, t.practiceId, { minBalanceCents: 1 });
    const rerun = await generateStatementBatch(t.db, t.practiceId, { minBalanceCents: 1 });
    expect(rerun.generated).toBe(0);
    expect(rerun.skipped).toBeGreaterThanOrEqual(batch.generated + 1);
  });
});

describe("payment plans", () => {
  let planId: string;

  it("refuses a plan larger than the balance", async () => {
    await expect(createPaymentPlan(t.db, t.practiceId, patientId, { totalCents: 99_999_00, installmentCount: 3, frequency: "monthly", startDate: "2026-01-01" })).rejects.toThrow(/exceeds/);
  });

  it("creates a schedule that sums to the plan total", async () => {
    const plan = await createPaymentPlan(t.db, t.practiceId, patientId, { totalCents: 27_000, installmentCount: 3, frequency: "monthly", startDate: new Date().toISOString().slice(0, 10) });
    planId = plan.id;
    const found = await getPlan(t.db, t.practiceId, planId);
    expect(found!.installments.reduce((a, i) => a + i.amountCents, 0)).toBe(27_000);
    await expect(createPaymentPlan(t.db, t.practiceId, patientId, { totalCents: 100, installmentCount: 2, frequency: "monthly", startDate: "2026-01-01" })).rejects.toThrow(/already/);
  });

  it("applies a payment oldest installment first and posts it to the ledger", async () => {
    const r = await recordPlanPayment(t.db, t.practiceId, planId, 12_000, "card");
    expect(r.allocations.map((a) => a.status)).toEqual(["paid", "partial"]);
    expect(await patientBalanceCents(t.db, patientId)).toBe(15_000);
  });

  it("marks late installments missed and defaults the plan, then restores it when caught up", async () => {
    const future = addMonths(new Date().toISOString().slice(0, 10), 4);
    await refreshPlanStatuses(t.db, t.practiceId, future);
    let found = await getPlan(t.db, t.practiceId, planId);
    expect(found!.plan.status).toBe("defaulted");
    expect(found!.installments.filter((i) => i.status === "missed").length).toBeGreaterThanOrEqual(2);

    const r = await recordPlanPayment(t.db, t.practiceId, planId, 15_000, "cash");
    expect(r.completed).toBe(true);
    found = await getPlan(t.db, t.practiceId, planId);
    expect(found!.plan.status).toBe("completed");
    expect(await patientBalanceCents(t.db, patientId)).toBe(0);
  });
});

describe("estimates", () => {
  it("verifies benefits and itemizes an insured estimate against the contract", async () => {
    const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.patientId, patientId)).limit(1);
    await contractFromPercent(t.db, t.practiceId, ins.payerId, 60);
    const est = await createEstimate(t.db, t.practiceId, {
      patientId, patientInsuranceId: ins.id, serviceDate: null, lines: [{ cpt: "99214", units: 1 }, { cpt: "80053", units: 1 }],
    });
    expect(est.kind).toBe("insured");
    expect(est.patientOwesCents + est.insurancePaysCents).toBe(est.allowedCents);
    expect(est.allowedCents).toBeLessThan(est.totalChargeCents);
    expect((est.basis as { uncontractedCodes: string[] }).uncontractedCodes).toEqual([]);
    const checks = await t.db.select().from(schema.eligibilityChecks).where(eq(schema.eligibilityChecks.patientInsuranceId, ins.id));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks[0].coinsurancePct).not.toBeNull();
  });

  it("issues a good faith estimate for a self-pay patient", async () => {
    const est = await createEstimate(t.db, t.practiceId, { patientId, patientInsuranceId: null, serviceDate: null, lines: [{ cpt: "99213", units: 1 }] });
    expect(est.kind).toBe("good_faith");
    expect(est.insurancePaysCents).toBe(0);
    expect(est.patientOwesCents).toBe(Math.round(est.totalChargeCents * 0.7));
  });
});
