import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { buildEdi835 } from "@/lib/edi/x835";
import { createEncounterWithClaim } from "./encounters";
import { timelyFilingParagraph, timelyFilingProof } from "./timely-filing";
import { draftAppeal } from "./appeals";
import { awvDueOn, awvGaps, ccmCandidates, hccRecapture } from "./care-gaps";
import { importCodeSet, parseHccMapping } from "./code-sets";
import { recordCareConsent } from "./care-programs";
import { handleStripeEvent } from "./portal";
import { cardOnFileCharges, revokeCardOnFile } from "./card-on-file";
import { patientBalanceCents } from "./billing";
import { modifierUsage, sampleModifierClaims } from "./productivity";
import { agreeRefundDemand, createRefundDemand, disputeRefundDemand, markDemandOffset, refundDemandAlerts } from "./refund-demands";
import { allowedFrom, eobFor } from "./eob";

const HCC = [
  "2026 Initial ICD-10-CM Mappings",
  "Diagnosis Code,Description,CMS-HCC ESRD Model Category V24,CMS-HCC Model Category V28",
  "E119,Type 2 diabetes mellitus without complications,19,38",
  "I509,Heart failure unspecified,85,226",
  "I10,Essential hypertension,,",
].join("\n");

describe("pure rules", () => {
  it("dates the next wellness visit after 11 full months", () => {
    expect(awvDueOn("2025-03-15")).toBe("2026-03-01");
    expect(awvDueOn("2025-12-31")).toBe("2026-12-01");
  });

  it("reads the V28 column of CMS's HCC mapping", () => {
    const p = parseHccMapping(HCC);
    expect(p.rows).toEqual([{ icd10: "E119", hcc: "38", label: "Type 2 diabetes mellitus without complications" }, { icd10: "I509", hcc: "226", label: "Heart failure unspecified" }]);
    expect(p.skipped).toBe(1); // hypertension does not risk-adjust
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let medicare: typeof schema.payers.$inferSelect;
  let commercial: typeof schema.payers.$inferSelect;
  const newPatient = async (mrn: string, payer: typeof schema.payers.$inferSelect, memberId: string) => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn, firstName: "Test", lastName: mrn, dob: "1950-01-01", sex: "F", phone: "4075550100" }).returning();
    const [ins] = await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: payer.id, memberId, relationship: "self" }).returning();
    return { patient: p, ins };
  };
  const visit = (patientId: string, dateOfService: string, lines: { cpt: string; modifiers?: string[]; chargeCents?: number }[], diagnoses = ["E11.9"]) =>
    createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, dateOfService, placeOfService: "11", diagnoses, lines: lines.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers ?? [], units: 1, chargeCents: l.chargeCents ?? 12_000, dxPointers: [1] })) });

  beforeAll(async () => {
    t = await testDb();
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    [medicare] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "medicare"))).limit(1);
    [commercial] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
  });
  afterAll(async () => { await t?.close(); });

  it("assembles proof of timely filing and puts it in the appeal", async () => {
    const { patient } = await newPatient("TF-1", commercial, "TF12345A");
    const { claim } = await visit(patient.id, "2026-05-01", [{ cpt: "99213" }]);
    await t.db.update(schema.claims).set({ submittedAt: new Date("2026-05-10T15:00:00Z"), status: "denied" }).where(eq(schema.claims.id, claim.id));
    await t.db.insert(schema.claimAcknowledgments).values([
      { claimId: claim.id, kind: "999", accepted: true, receivedAt: new Date("2026-05-10T15:05:00Z") },
      { claimId: claim.id, kind: "277CA", accepted: true, code: "A2:20", receivedAt: new Date("2026-05-11T09:00:00Z") },
    ]);
    const proof = (await timelyFilingProof(t.db, t.practiceId, claim.id))!;
    expect(proof).toMatchObject({ firstSubmittedOn: "2026-05-10", daysAfterService: 9, inTime: true });
    expect(proof.submissions[0].acks.map((a) => `${a.kind}:${a.on}`)).toEqual(["999:2026-05-10", "277CA:2026-05-11"]);
    expect(timelyFilingParagraph(proof)).toMatch(/first submitted on 2026-05-10, 9 days later/);
    const [denial] = await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: claim.id, category: "timely_filing", carc: "29", amountCents: 12_000 }).returning();
    const letter = await draftAppeal(t.db, t.practiceId, denial.id, t.userId);
    expect(letter.body).toContain("Proof of timely filing");
    expect(letter.body).toContain("277CA accepted (A2:20) on 2026-05-11");
  });

  it("lists Medicare patients due a wellness visit", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const due = await newPatient("AWV-DUE", medicare, "1EG4TE5MK73");
    await visit(due.patient.id, ago(400), [{ cpt: "G0439" }]);
    const recent = await newPatient("AWV-RECENT", medicare, "2EG4TE5MK74");
    await visit(recent.patient.id, ago(60), [{ cpt: "G0439" }]);
    const gaps = await awvGaps(t.db, t.practiceId, today);
    expect(gaps.find((g) => g.patientId === due.patient.id)?.lastAwv).toBe(ago(400));
    expect(gaps.some((g) => g.patientId === recent.patient.id)).toBe(false);
  });

  it("finds care management candidates and HCCs not yet recaptured", async () => {
    const year = new Date().getUTCFullYear();
    const { patient } = await newPatient("CCM-1", medicare, "3EG4TE5MK75");
    await visit(patient.id, `${year - 1}-06-10`, [{ cpt: "99214" }], ["E11.9", "I50.9"]);
    await visit(patient.id, new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10), [{ cpt: "99214" }], ["E11.9", "I10"]);
    const before = await ccmCandidates(t.db, t.practiceId);
    expect(before.candidates.find((c) => c.patientId === patient.id)?.groups).toContain("E11");
    await recordCareConsent(t.db, t.practiceId, patient.id, "ccm", new Date().toISOString().slice(0, 10));
    expect((await ccmCandidates(t.db, t.practiceId)).candidates.some((c) => c.patientId === patient.id)).toBe(false);

    expect((await hccRecapture(t.db, t.practiceId, year)).mappingYear).toBeNull();
    await importCodeSet(t.db, "hcc", HCC, "V28 mapping", "test", year);
    const r = await hccRecapture(t.db, t.practiceId, year);
    const mine = r.gaps.filter((g) => g.patientId === patient.id);
    expect(mine.map((g) => g.hcc)).toEqual(["226"]); // heart failure not coded this year; diabetes was
  });

  it("saves a card on file with its limit, gives notice, then charges after 3 days", async () => {
    const { patient } = await newPatient("COF-1", commercial, "CF12345A");
    const { claim } = await visit(patient.id, "2026-08-01", [{ cpt: "99213" }]);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, claimId: claim.id, type: "transfer_to_patient", amountCents: 30_000, note: "PR-1" });
    const [pay] = await t.db.insert(schema.onlinePayments).values({ practiceId: t.practiceId, patientId: patient.id, amountCents: 1_000, source: "portal", providerRef: "cs_cof_1" }).returning();
    await handleStripeEvent(t.db, { id: "evt_cof", type: "checkout.session.completed", data: { object: { id: "cs_cof_1", payment_status: "paid", payment_intent: "pi_cof", customer: "cus_cof", metadata: { payment_id: pay.id, autopay: "0", card_on_file: "1", card_on_file_max: "20000" } } } }, {
      getPaymentIntent: async () => ({ id: "pi_cof", status: "succeeded", payment_method: "pm_cof", customer: "cus_cof" }),
      getPaymentMethod: async () => ({ id: "pm_cof", card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 } }),
    });
    const [card] = await t.db.select().from(schema.savedCards).where(eq(schema.savedCards.patientId, patient.id));
    expect(card).toMatchObject({ balanceMaxCents: 20_000, autopayPlanId: null, last4: "4242" });
    expect(card.balanceAuthorizedAt).toBeInstanceOf(Date);

    const charges: { amountCents: number; idempotencyKey: string }[] = [];
    const client = { chargeSaved: async (p: { amountCents: number; idempotencyKey: string }) => { charges.push(p); return { id: "pi_charge", status: "succeeded" }; } };
    const now = new Date("2026-09-01T12:00:00Z");
    expect(await cardOnFileCharges(t.db, t.practiceId, now, client)).toMatchObject({ noticed: 1, charged: 0 });
    expect(await cardOnFileCharges(t.db, t.practiceId, now, client)).toMatchObject({ noticed: 0, charged: 0 }); // waits for the date
    const owed = await patientBalanceCents(t.db, patient.id);
    const r = await cardOnFileCharges(t.db, t.practiceId, new Date("2026-09-04T12:00:00Z"), client);
    expect(r).toMatchObject({ charged: 1, failed: 0 });
    expect(charges[0].amountCents).toBe(Math.min(owed, 20_000)); // never more than the limit
    expect(await patientBalanceCents(t.db, patient.id)).toBe(owed - charges[0].amountCents);
    // Stopping it cancels the next notice.
    await cardOnFileCharges(t.db, t.practiceId, new Date("2026-09-05T12:00:00Z"), client);
    await revokeCardOnFile(t.db, t.practiceId, patient.id, t.userId);
    expect(await cardOnFileCharges(t.db, t.practiceId, new Date("2026-09-09T12:00:00Z"), client)).toMatchObject({ noticed: 0, charged: 0 });
    expect(charges).toHaveLength(1);
  });

  it("measures modifier 25 and 59 use and samples the claims", async () => {
    const { patient } = await newPatient("MOD-1", commercial, "MD12345A");
    await visit(patient.id, "2026-07-01", [{ cpt: "99213", modifiers: ["25"] }, { cpt: "20610", modifiers: ["59"] }]);
    const r = await modifierUsage(t.db, t.practiceId, "2026-07-01", "2026-07-01");
    const me = r.providers.find((p) => p.id === providerId)!;
    expect(me.em25).toBeGreaterThanOrEqual(1);
    expect(me.procs59).toBeGreaterThanOrEqual(1);
    const sample = await sampleModifierClaims(t.db, t.practiceId, providerId, "2026-07-01", "2026-07-01");
    expect(sample.some((s) => s.codes.includes("99213-25"))).toBe(true);
  });

  it("tracks a payer's refund demand through dispute, and settles it when the payer takes the money back", async () => {
    const { patient } = await newPatient("RD-1", commercial, "RD12345A");
    const { claim } = await visit(patient.id, "2026-06-01", [{ cpt: "99214" }]);
    const d = await createRefundDemand(t.db, t.practiceId, { claimControlNumber: claim.controlNumber, amountCents: 5_000, receivedOn: "2026-09-01", reference: "OR-778" }, t.userId);
    expect(d).toMatchObject({ disputeBy: "2026-10-01", status: "open" });
    expect((await refundDemandAlerts(t.db, t.practiceId, new Date("2026-09-28T12:00:00Z"))).dueSoon).toBeGreaterThanOrEqual(1);
    const letter = await disputeRefundDemand(t.db, t.practiceId, d.id, "The patient was eligible on the date of service; your 271 of May 30 confirms active coverage.", t.userId);
    expect(letter).toContain("Dispute of refund request OR-778");
    expect(letter).toContain(claim.controlNumber);
    await expect(disputeRefundDemand(t.db, t.practiceId, d.id, "again")).rejects.toThrow(/already disputed/);
    // Agreeing on a claim that is not overpaid on the books: no refund, the payer offsets.
    const second = await createRefundDemand(t.db, t.practiceId, { claimControlNumber: claim.controlNumber, amountCents: 2_500, receivedOn: "2026-09-02" });
    const agreed = await agreeRefundDemand(t.db, t.practiceId, second.id, t.userId);
    expect(agreed.refundId).toBeNull();
    expect((await markDemandOffset(t.db, claim.id, 2_500))?.id).toBe(second.id);
    const [row] = await t.db.select().from(schema.payerRefundDemands).where(eq(schema.payerRefundDemands.id, second.id));
    expect(row.status).toBe("offset");
  });

  it("rebuilds the primary payer's EOB from its 835", async () => {
    const { patient } = await newPatient("EOB-1", commercial, "EB12345A");
    const { claim } = await visit(patient.id, "2026-06-15", [{ cpt: "99213", chargeCents: 15_000 }]);
    const raw = buildEdi835({
      payerName: commercial.name, payerId: commercial.payerId, checkNumber: "EFT-EOB-1", paymentDate: new Date("2026-07-01T12:00:00Z"),
      claims: [{ patientControlNumber: claim.controlNumber, payerClaimNumber: "PCN-EOB-1", statusCode: "1", chargedCents: 15_000, paidCents: 8_000, patientResponsibilityCents: 2_000, adjustments: [],
        lines: [{ cpt: "99213", chargedCents: 15_000, paidCents: 8_000, units: 1, adjustments: [{ group: "CO", reason: "45", amountCents: 5_000 }, { group: "PR", reason: "2", amountCents: 2_000 }] }] }],
    });
    const [remit] = await t.db.insert(schema.remittances).values({ practiceId: t.practiceId, payerName: commercial.name, checkNumber: "EFT-EOB-1", amountCents: 8_000, paymentDate: "2026-07-01", raw835: raw }).returning();
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, claimId: claim.id, remittanceId: remit.id, type: "insurance_payment", amountCents: 8_000, note: "paid" });
    const e = (await eobFor(t.db, t.practiceId, claim.id))!;
    expect(e.payments).toHaveLength(1);
    expect(e.payments[0]).toMatchObject({ checkNumber: "EFT-EOB-1", claim: { paidCents: 8_000, patientResponsibilityCents: 2_000 } });
    expect(allowedFrom(e.payments[0].claim)).toBe(10_000);
  });
});
