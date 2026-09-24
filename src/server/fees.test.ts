import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { buildEdi835 } from "@/lib/edi/x835";
import { createEncounterWithClaim } from "./encounters";
import { importRemittance, postRemittance } from "./claims";
import {
  allowedFromLedger, contractFromPercent, expectedAllowed, judgeUnderpayment, listUnderpayments,
  scanUnderpayments, setUnderpaymentStatus, standardCharges, underpaymentThreshold,
} from "./fees";

describe("underpayment arithmetic", () => {
  it("tolerates a dollar or one percent, whichever is larger", () => {
    expect(underpaymentThreshold(5_000)).toBe(100);
    expect(underpaymentThreshold(50_000)).toBe(500);
  });

  it("sums contracted rates by units and reports uncontracted codes", () => {
    const rates = new Map([["99213", 9000], ["36415", 1000]]);
    expect(expectedAllowed([{ cpt: "99213", units: 1 }, { cpt: "36415", units: 2 }], rates)).toEqual({ expectedCents: 11_000, missing: [] });
    expect(expectedAllowed([{ cpt: "99999", units: 1 }], rates).missing).toEqual(["99999"]);
  });

  it("flags only shortfalls beyond tolerance", () => {
    expect(judgeUnderpayment(10_000, 9_950).underpaid).toBe(false);
    expect(judgeUnderpayment(10_000, 9_000)).toEqual({ underpaid: true, varianceCents: 1_000 });
    expect(judgeUnderpayment(10_000, 12_000).underpaid).toBe(false);
  });

  it("derives allowed as charges less the CO-45 contractual write-down only", () => {
    const allowed = allowedFromLedger([
      { type: "charge", amountCents: 20_000, groupCode: null, reasonCode: null },
      { type: "adjustment", amountCents: 6_000, groupCode: "CO", reasonCode: "45" },
      { type: "transfer_to_patient", amountCents: 2_000, groupCode: "PR", reasonCode: "3" },
      { type: "adjustment", amountCents: 500, groupCode: "OA", reasonCode: "23" },
    ]);
    expect(allowed).toBe(14_000);
  });
});

describe("underpayment detection against a real 835", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let payer: typeof schema.payers.$inferSelect;
  let claim: typeof schema.claims.$inferSelect;
  let chargedCents: number;

  beforeAll(async () => {
    t = await testDb();
    const [row] = await t.db
      .select({ patient: schema.patients, ins: schema.patientInsurances, payer: schema.payers })
      .from(schema.patientInsurances)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patientInsurances.active, true)))
      .limit(1);
    payer = row.payer;
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    const fees = await standardCharges(t.db, t.practiceId);
    const dos = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const created = await createEncounterWithClaim(t.db, t.practiceId, {
      patientId: row.patient.id,
      providerId: provider.id,
      dateOfService: dos,
      placeOfService: "11",
      diagnoses: ["E11.9"],
      lines: [
        { cpt: "99213", modifiers: [], units: 1, chargeCents: fees.get("99213")!, dxPointers: [1] },
        { cpt: "36415", modifiers: [], units: 1, chargeCents: fees.get("36415")!, dxPointers: [1] },
      ],
    });
    claim = created.claim;
    chargedCents = fees.get("99213")! + fees.get("36415")!;
    // Contract the payer at 70% of standard charges.
    await contractFromPercent(t.db, t.practiceId, payer.id, 70);
  });
  afterAll(async () => { await t?.close(); });

  /** Pays every line at `allowedPct` of its charge, with a $20 copay on the first. */
  async function remit(allowedPct: number) {
    const fees = await standardCharges(t.db, t.practiceId);
    const lines = [
      { cpt: "99213", charged: fees.get("99213")! },
      { cpt: "36415", charged: fees.get("36415")! },
    ].map((l, i) => {
      const allowed = Math.round(l.charged * allowedPct);
      const pr = i === 0 ? 2_000 : 0;
      return {
        cpt: l.cpt, chargedCents: l.charged, paidCents: allowed - pr, units: 1,
        adjustments: [
          { group: "CO" as const, reason: "45", amountCents: l.charged - allowed },
          ...(pr ? [{ group: "PR" as const, reason: "3", amountCents: pr }] : []),
        ],
      };
    });
    const raw = buildEdi835({
      payerName: payer.name, payerId: payer.payerId, checkNumber: `T${Math.round(allowedPct * 100)}`, paymentDate: new Date(),
      claims: [{
        patientControlNumber: claim.controlNumber, payerClaimNumber: "PCN1", statusCode: "1",
        chargedCents, paidCents: lines.reduce((a, l) => a + l.paidCents, 0), patientResponsibilityCents: 2_000,
        adjustments: [], lines,
      }],
    });
    const id = await importRemittance(t.db, t.practiceId, raw);
    return postRemittance(t.db, id);
  }

  it("records an underpayment when an ERA allows less than the contract", async () => {
    const summary = (await remit(0.6)) as { underpaid?: number };
    expect(summary.underpaid).toBe(1);

    const fees = await standardCharges(t.db, t.practiceId);
    const [u] = await listUnderpayments(t.db, t.practiceId);
    expect(u.claim.id).toBe(claim.id);
    expect(u.underpayment.expectedAllowedCents).toBe(Math.round(fees.get("99213")! * 0.7) + Math.round(fees.get("36415")! * 0.7));
    expect(u.underpayment.actualAllowedCents).toBe(Math.round(fees.get("99213")! * 0.6) + Math.round(fees.get("36415")! * 0.6));
    expect(u.underpayment.varianceCents).toBe(u.underpayment.expectedAllowedCents - u.underpayment.actualAllowedCents);
  });

  it("the set-based scan agrees with the per-claim check and is idempotent", async () => {
    const first = await scanUnderpayments(t.db, t.practiceId);
    expect(first.flagged).toBeGreaterThanOrEqual(1);
    const rows = await t.db.execute<{ n: string }>(sql`SELECT count(*)::int AS n FROM underpayments WHERE claim_id = ${claim.id}`);
    expect(Number(rows.rows[0].n)).toBe(1);
  });

  it("finds underpaid claims in historical data, not only freshly posted ones", async () => {
    // The seeded practice already holds paid claims for this payer, loaded
    // without an 835. Some were allowed below the 70% contract, and the scan
    // has to find them from the ledger alone.
    const open = await listUnderpayments(t.db, t.practiceId, "open");
    expect(open.some((u) => u.claim.id !== claim.id)).toBe(true);
  });

  it("leaves a finding alone once it has been worked", async () => {
    const [mine] = (await listUnderpayments(t.db, t.practiceId)).filter((u) => u.claim.id === claim.id);
    await setUnderpaymentStatus(t.db, t.practiceId, mine.underpayment.id, "appealed", "Sent reconsideration");
    await scanUnderpayments(t.db, t.practiceId);
    const appealed = await listUnderpayments(t.db, t.practiceId, "appealed");
    expect(appealed.find((u) => u.claim.id === claim.id)?.underpayment.note).toBe("Sent reconsideration");
    const open = await listUnderpayments(t.db, t.practiceId, "open");
    expect(open.some((u) => u.claim.id === claim.id)).toBe(false);
  });
});
