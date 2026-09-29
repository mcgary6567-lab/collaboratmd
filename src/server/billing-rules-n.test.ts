import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { buildEdi835 } from "@/lib/edi/x835";
import { scrubClaim, type ScrubClaim } from "@/lib/scrub/rules";
import { isUnlistedCode } from "@/lib/codes/unlisted";
import { levelForMinutes, prolongedUnits } from "@/lib/time-units";
import { createEncounterWithClaim } from "./encounters";
import { importRemittance, loadClaimBundle, postRemittance } from "./claims";
import { buildClaimEdi } from "./claim-edi";
import { paperClaim } from "./paper-claim";
import { feeCheck, feeGaps } from "./fee-check";
import { standardCharges } from "./fees";
import { backfillRemittanceLines } from "./remittance-lines";
import { batchAppealGroups, batchAppealLetter, sendBatchAppeal } from "./batch-appeals";
import { gfeVariances } from "./gfe-variance";
import { recheckYearStart } from "./patients";
import { collectionsReadiness, placeWithAgency, recordAssistanceOffered, sendFinalNotice } from "./collections";
import { saveCollectionSafeguards } from "./policies";

const scrub = (lines: ScrubClaim["lines"], type = "commercial"): ScrubClaim => ({
  patient: { firstName: "Maria", lastName: "Garcia", dob: "1950-04-12", sex: "F", address1: "1 Main St", zip: "32801" },
  insurance: { memberId: "ABC123", payerId: "00590", relationship: "self" },
  provider: { npi: "1234567893", taxonomy: "207Q00000X" },
  practice: { npi: "1234567893", taxId: "12-3456789" },
  encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9"] },
  lines, payer: { timelyFilingDays: 365, type }, today: new Date("2026-09-21T00:00:00Z"),
});
const line = (cpt: string, over: Partial<ScrubClaim["lines"][number]> = {}) => ({ lineNumber: 1, cpt, modifiers: [], units: 1, chargeCents: 20_000, dxPointers: [1], ...over });
const rules = (c: ScrubClaim) => scrubClaim(c).map((f) => `${f.rule}:${f.severity}`);

describe("pure rules", () => {
  it("requires a description on unlisted and unclassified codes", () => {
    expect([isUnlistedCode("17999"), isUnlistedCode("J3490"), isUnlistedCode("99213"), isUnlistedCode("J1100")]).toEqual([true, true, false, false]);
    expect(rules(scrub([line("17999")]))).toContain("UNLISTED:error");
    expect(rules(scrub([line("17999", { description: "Laser excision of lesion, left forearm" })]))).not.toContain("UNLISTED:error");
  });

  it("checks office visit time and prolonged services", () => {
    expect(levelForMinutes("99215", 35)).toBe("99214");
    expect(levelForMinutes("99205", 10)).toBeNull();
    expect([prolongedUnits("99215", 55, false), prolongedUnits("99215", 54, false), prolongedUnits("99215", 69, true), prolongedUnits("99215", 68, true), prolongedUnits("99205", 90, false), prolongedUnits("99205", 89, true)]).toEqual([1, 0, 1, 0, 2, 1]);
    expect(rules(scrub([line("99215", { minutes: 35 })]))).toContain("EM_TIME:warning");
    expect(rules(scrub([line("99215", { minutes: 45 })]))).not.toContain("EM_TIME:warning");
    // Commercial: 99417 at 55 minutes; suggested when missing, refused when the time does not support it.
    expect(rules(scrub([line("99215", { minutes: 58 })]))).toContain("PROLONGED:warning");
    expect(rules(scrub([line("99215", { minutes: 58 }), line("99417", { lineNumber: 2, units: 1 })])).filter((r) => r.startsWith("PROLONGED"))).toEqual([]);
    expect(rules(scrub([line("99215", { minutes: 58 }), line("99417", { lineNumber: 2, units: 2 })]))).toContain("PROLONGED:error");
    // Medicare: G2212, from 69 minutes; 99417 refused.
    expect(rules(scrub([line("99215", { minutes: 60 }), line("99417", { lineNumber: 2 })], "medicare"))).toContain("PROLONGED:error");
    expect(rules(scrub([line("99215", { minutes: 70 }), line("G2212", { lineNumber: 2 })], "medicare")).filter((r) => r.startsWith("PROLONGED"))).toEqual([]);
    expect(rules(scrub([line("99215", { minutes: 60 }), line("G2212", { lineNumber: 2 })], "medicare"))).toContain("PROLONGED:error");
  });

  it("lists charges below the highest allowed amount, with a suggested charge", () => {
    const gaps = feeGaps([{ cpt: "99213", lines: 40 }, { cpt: "99214", lines: 10 }], new Map([["99213", 9_000], ["99214", 20_000]]), new Map([["99213", { cents: 10_234, source: "Aetna allowed (835)" }], ["99214", { cents: 15_000, source: "contract" }]]));
    expect(gaps).toEqual([{ cpt: "99213", lines: 40, chargeCents: 9_000, highestCents: 10_234, source: "Aetna allowed (835)", suggestedCents: 10_500 }]);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let commercial: typeof schema.payers.$inferSelect;
  const newPatient = async (mrn: string) => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn, firstName: "Test", lastName: mrn, dob: "1970-01-01", sex: "F" }).returning();
    const [ins] = await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: commercial.id, memberId: `${mrn.replace(/\W/g, "")}A`, relationship: "self" }).returning();
    return { patient: p, ins };
  };
  const visit = (patientId: string, dateOfService: string, lines: { cpt: string; chargeCents?: number; description?: string }[]) =>
    createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, dateOfService, placeOfService: "11", diagnoses: ["E11.9"], lines: lines.map((l) => ({ cpt: l.cpt, modifiers: [], units: 1, chargeCents: l.chargeCents ?? 12_000, dxPointers: [1], description: l.description })) });

  beforeAll(async () => {
    t = await testDb();
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    [commercial] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
  });
  afterAll(async () => { await t?.close(); });

  it("sends an unlisted code's description in SV101-7 and on the paper claim", async () => {
    const { patient } = await newPatient("UNL-1");
    const { claim } = await visit(patient.id, "2026-09-02", [{ cpt: "17999", chargeCents: 40_000, description: "Laser excision: lesion, left forearm*" }]);
    const edi = buildClaimEdi((await loadClaimBundle(t.db, claim.id))!, { now: new Date("2026-09-25T10:00:00Z"), authorizationNumber: null, attachments: [] });
    expect(edi).toContain("SV1*HC:17999:::::Laser excision lesion, left forearm*400.00");
    const paper = (await paperClaim(t.db, t.practiceId, claim.id))!;
    expect(paper.pages.flat().some((f) => f.text.includes("Laser excision"))).toBe(true);
  });

  it("keeps each 835 line with its allowed amount, fills in old remittances, and finds charges below it", async () => {
    const { patient } = await newPatient("LINE-1");
    const { claim } = await visit(patient.id, "2026-08-10", [{ cpt: "99214", chargeCents: 10_000 }]);
    await t.db.update(schema.claims).set({ status: "submitted" }).where(eq(schema.claims.id, claim.id));
    const raw = buildEdi835({
      payerName: commercial.name, payerId: commercial.payerId, checkNumber: "EFT-LINE-1", paymentDate: new Date(),
      claims: [{ patientControlNumber: claim.controlNumber, payerClaimNumber: "PCN-L1", statusCode: "1", chargedCents: 10_000, paidCents: 9_000, patientResponsibilityCents: 2_500, adjustments: [],
        lines: [{ cpt: "99214", chargedCents: 10_000, paidCents: 9_000, units: 1, adjustments: [{ group: "PR", reason: "2", amountCents: 1_000 }] }] }],
    });
    const remitId = await importRemittance(t.db, t.practiceId, raw);
    await postRemittance(t.db, remitId);
    const lines = await t.db.select().from(schema.remittanceLines).where(eq(schema.remittanceLines.claimId, claim.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ cpt: "99214", allowedCents: 10_000, paidCents: 9_000 });
    await t.db.delete(schema.remittanceLines).where(eq(schema.remittanceLines.remittanceId, remitId));
    const back = await backfillRemittanceLines(t.db, t.practiceId);
    expect(back.lines).toBeGreaterThanOrEqual(1);
    expect(await backfillRemittanceLines(t.db, t.practiceId)).toMatchObject({ remittances: 0 });
    // The standard charge for 99214 may be lower than what the payer allowed.
    await t.db.insert(schema.cptCodes).values({ code: "99214", description: "Office visit", defaultFeeCents: 8_000 }).onConflictDoUpdate({ target: schema.cptCodes.code, set: { defaultFeeCents: 8_000 } });
    const charge = (await standardCharges(t.db, t.practiceId)).get("99214")!;
    const r = await feeCheck(t.db, t.practiceId);
    const gap = r.gaps.find((g) => g.cpt === "99214");
    // The payer allowed $100.00 for 99214; a lower standard charge must be listed.
    if (charge < 10_000) expect(gap).toMatchObject({ chargeCents: charge, suggestedCents: Math.ceil(gap!.highestCents / 500) * 500 });
    else expect(gap).toBeUndefined();
    expect(gap === undefined || gap.highestCents >= 10_000).toBe(true);
  });

  it("appeals a payer's same-reason denials with one letter", async () => {
    const { patient } = await newPatient("BATCH-1");
    const made = [];
    for (const d of ["2026-07-01", "2026-07-02"]) {
      const { claim } = await visit(patient.id, d, [{ cpt: "99213" }]);
      const [den] = await t.db.insert(schema.denials).values({ practiceId: t.practiceId, claimId: claim.id, category: "medical_necessity", carc: "B7", amountCents: 12_000 }).returning();
      made.push({ claim, den });
    }
    const group = (await batchAppealGroups(t.db, t.practiceId)).find((g) => g.payerId === commercial.id && g.carc === "B7")!;
    expect(group.count).toBeGreaterThanOrEqual(2);
    const letter = await batchAppealLetter(t.db, t.practiceId, commercial.id, "B7", "The provider was certified for this service on the dates shown.");
    for (const m of made) expect(letter.text).toContain(m.claim.controlNumber);
    expect(letter.text).toContain("The provider was certified");
    const r = await sendBatchAppeal(t.db, t.practiceId, commercial.id, "B7", "The provider was certified.", t.userId);
    expect(r.sent).toBe(group.count);
    for (const m of made) {
      const [d] = await t.db.select().from(schema.denials).where(eq(schema.denials.id, m.den.id));
      expect(d.status).toBe("appealed");
    }
    await expect(sendBatchAppeal(t.db, t.practiceId, commercial.id, "B7", "")).rejects.toThrow(/No open denials/);
  });

  it("flags a self-pay bill $400 or more over its good faith estimate", async () => {
    const { patient } = await newPatient("GFE-1");
    await t.db.insert(schema.estimates).values({ practiceId: t.practiceId, patientId: patient.id, estimateNumber: "GFE-T1", kind: "good_faith", serviceDate: "2026-06-05", lines: [], totalChargeCents: 20_000, allowedCents: 20_000, insurancePaysCents: 0, patientOwesCents: 20_000, basis: {} });
    await visit(patient.id, "2026-06-05", [{ cpt: "99214", chargeCents: 30_000 }]);
    expect((await gfeVariances(t.db, t.practiceId, patient.id))).toEqual([]); // $100 over: under the threshold
    await visit(patient.id, "2026-06-05", [{ cpt: "93000", chargeCents: 35_000 }]);
    const [v] = await gfeVariances(t.db, t.practiceId, patient.id);
    expect(v).toMatchObject({ estimatedCents: 20_000, billedCents: 65_000, overCents: 45_000 });
  });

  it("re-checks coverage in January only", async () => {
    expect(await recheckYearStart(t.db, t.practiceId, new Date("2026-09-10T15:00:00Z"))).toMatchObject({ skipped: "Only runs in January" });
    const { patient, ins } = await newPatient("JAN-1");
    const at = new Date("2027-01-12T15:00:00Z");
    await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: patient.id, providerId, startsAt: at, endsAt: new Date(at.getTime() + 1_800_000) });
    const r = await recheckYearStart(t.db, t.practiceId, new Date("2027-01-05T15:00:00Z"));
    expect(r.checked).toBeGreaterThanOrEqual(1);
    expect((await t.db.select().from(schema.eligibilityChecks).where(eq(schema.eligibilityChecks.patientInsuranceId, ins.id))).length).toBe(1);
  });

  it("holds an account from an agency until the practice's safeguards are met", async () => {
    const { patient } = await newPatient("COLL-1");
    const { claim } = await visit(patient.id, "2026-03-01", [{ cpt: "99213" }]);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, claimId: claim.id, type: "transfer_to_patient", amountCents: 9_000, note: "PR-1" });
    await saveCollectionSafeguards(t.db, t.practiceId, { minStatements: 3, minBalanceCents: 5_000, requireAssistanceOffer: true }, t.userId);
    const before = await collectionsReadiness(t.db, t.practiceId, patient.id);
    expect(before.ready).toBe(false);
    expect(before.missing.join(" | ")).toMatch(/3 statements.*financial assistance/);
    const now = new Date("2026-09-01T12:00:00Z");
    const { collection } = await sendFinalNotice(t.db, t.practiceId, patient.id, { userId: t.userId, now });
    const later = { userId: t.userId, now: new Date("2026-09-20T12:00:00Z") };
    await expect(placeWithAgency(t.db, t.practiceId, collection.id, "Acme Recovery", later)).rejects.toThrow(/safeguards are not met/);
    for (let i = 0; i < 3; i++) {
      await t.db.insert(schema.statements).values({
        practiceId: t.practiceId, patientId: patient.id, statementNumber: `ST-COLL-${i}`, statementDate: `2026-0${4 + i}-01`, dueDate: `2026-0${4 + i}-25`,
        chargesCents: 12_000, insurancePaidCents: 3_000, adjustmentsCents: 0, patientPaidCents: 0, amountDueCents: 9_000, detail: { visits: [], unappliedPaymentsCents: 0, discountsCents: 0 },
      });
    }
    await recordAssistanceOffered(t.db, t.practiceId, patient.id, "2026-08-01", t.userId);
    expect((await collectionsReadiness(t.db, t.practiceId, patient.id)).ready).toBe(true);
    const placed = await placeWithAgency(t.db, t.practiceId, collection.id, "Acme Recovery", later);
    expect(placed.stage).toBe("agency");
  });
});
