import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { createEncounterWithClaim } from "./encounters";
import { buildStatementDetail, generateStatement, patientBalanceCents } from "./billing";
import { billableBalanceCents, billTo, familyOf, familyPayment, qmbProtected, setGuarantor, setQmb, writeOffQmbCostSharing } from "./patient-accounts";
import { closeDay, dayTotals, varianceOf } from "./cash-close";
import { agencyPerformance, recordAgencyRecovery } from "./collections";
import { periodTotals } from "./accounting";
import { chargeFee, feeCandidates, recentFees, saveFeePolicy, waiveFee } from "./missed-fees";
import { inferRootCause, rootCauseReport, setRootCause } from "./denial-causes";
import { chargemasterPrice, chargemasterStats, importChargemaster, markReviewed, priceTransparencyCsv } from "./chargemaster";
import { compensation, payFor, savePlan } from "./compensation";

describe("pure parts", () => {
  it("guesses a denial's root cause from its category and reason code", () => {
    expect(inferRootCause("eligibility", "31")).toBe("registration");
    expect(inferRootCause("eligibility", "27")).toBe("eligibility");
    expect(inferRootCause("coding", "16")).toBe("coding");
    expect(inferRootCause("other", "16")).toBe("billing_error");
    expect(inferRootCause("other", "96")).toBe("benefit_limit");
    expect(inferRootCause("authorization", "197")).toBe("authorization");
    expect(inferRootCause("other", "999")).toBe("billing_error");
  });

  it("works out a provider's pay under each kind of plan", () => {
    const plan = (kind: string, p: Partial<Parameters<typeof payFor>[0]> = {}) => ({ kind, baseCents: 0, collectionsPct: null, perRvuCents: null, threshold: null, ...p });
    expect(payFor(plan("collections", { collectionsPct: 40 }), 1_000_000, 0)).toBe(400_000);
    expect(payFor(plan("wrvu", { perRvuCents: 4_500 }), 0, 5.5)).toBe(24_750);
    // Threshold in dollars for collections, in work RVUs for wRVU plans.
    const bonus = plan("base_bonus_collections", { baseCents: 1_000_000, collectionsPct: 10, threshold: 20_000 });
    expect(payFor(bonus, 2_500_000, 0)).toBe(1_050_000);
    expect(payFor(bonus, 1_000_000, 0)).toBe(1_000_000);
    expect(payFor(plan("base_bonus_wrvu", { baseCents: 800_000, perRvuCents: 5_000, threshold: 100 }), 0, 150)).toBe(1_050_000);
  });

  it("measures the drawer against what was posted", () => {
    expect(varianceOf({ cash: 5_000, check: 2_000 }, { countedCashCents: 4_900, countedChecksCents: 2_000, cardBatchCents: 0 })).toEqual({ cash: -100, check: 0, card: 0 });
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let commercial: typeof schema.payers.$inferSelect;
  let medicare: typeof schema.payers.$inferSelect;
  let medicaid: typeof schema.payers.$inferSelect;
  const today = new Date().toISOString().slice(0, 10);
  const newPatient = async (mrn: string, payer = commercial, extra: Partial<typeof schema.patients.$inferInsert> = {}) => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn, firstName: "Dana", lastName: `Test${mrn.replace(/\W/g, "")}`, dob: "1960-02-02", sex: "F", ...extra }).returning();
    const [ins] = await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: payer.id, memberId: `${mrn.replace(/\W/g, "")}M`, relationship: "self", createdBy: t.userId, source: "staff" }).returning();
    return { patient: p, ins };
  };
  const visit = (patientId: string, dateOfService: string, chargeCents = 12_000) =>
    createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, dateOfService, placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents, dxPointers: [1] }] });
  const owe = (patientId: string, amountCents: number, claimId?: string) =>
    t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId, claimId: claimId ?? null, type: "transfer_to_patient", amountCents });

  beforeAll(async () => {
    t = await testDb();
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    const payer = async (type: string) => (await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, type))).limit(1))[0];
    [commercial, medicare, medicaid] = await Promise.all([payer("commercial"), payer("medicare"), payer("medicaid")]);
  });
  afterAll(async () => { await t?.close(); });

  it("keeps Medicare cost-sharing off a QMB patient's bill and writes it off", async () => {
    const { patient, ins } = await newPatient("QMB-1", medicare);
    const { claim } = await visit(patient.id, "2026-08-04");
    expect(claim.payerId).toBe(medicare.id);
    await owe(patient.id, 3_000, claim.id);
    expect((await buildStatementDetail(t.db, patient.id)).totals.amountDueCents).toBe(3_000);

    const { ins: other } = await newPatient("QMB-2", commercial);
    await expect(setQmb(t.db, t.practiceId, other.id, { qmb: true })).rejects.toThrow(/Medicare/);
    await expect(writeOffQmbCostSharing(t.db, t.practiceId, patient.id)).rejects.toThrow(/Qualified Medicare/);

    await setQmb(t.db, t.practiceId, ins.id, { qmb: true, verifiedOn: "2026-08-01" }, t.userId);
    const d = await buildStatementDetail(t.db, patient.id);
    expect(d.qmbProtectedCents).toBe(3_000);
    expect(d.totals.amountDueCents).toBe(0);
    expect(await qmbProtected(t.db, patient.id)).toBe(3_000);
    expect(await billableBalanceCents(t.db, patient.id)).toBe(0);
    expect(await patientBalanceCents(t.db, patient.id)).toBe(3_000); // still on the books until written off
    await expect(generateStatement(t.db, t.practiceId, patient.id)).rejects.toThrow(/no balance/);

    expect(await writeOffQmbCostSharing(t.db, t.practiceId, patient.id, t.userId)).toEqual({ claims: 1, cents: 3_000 });
    expect(await patientBalanceCents(t.db, patient.id)).toBe(0);
    expect((await writeOffQmbCostSharing(t.db, t.practiceId, patient.id)).cents).toBe(0);
  });

  it("bills a family to its guarantor and spreads one payment across it", async () => {
    const { patient: parent } = await newPatient("FAM-P", commercial, { dob: "1980-03-03" });
    const { patient: older } = await newPatient("FAM-K1", commercial, { dob: "2010-01-01" });
    const { patient: younger } = await newPatient("FAM-K2", commercial, { dob: "2012-01-01" });
    await setGuarantor(t.db, t.practiceId, older.id, "FAM-P", t.userId);
    await setGuarantor(t.db, t.practiceId, younger.id, "FAM-P");
    await expect(setGuarantor(t.db, t.practiceId, parent.id, "FAM-P")).rejects.toThrow(/own guarantor/);
    await expect(setGuarantor(t.db, t.practiceId, parent.id, "FAM-K1")).rejects.toThrow(/guarantor of their own/);
    await expect(setGuarantor(t.db, t.practiceId, older.id, "NOPE-1")).rejects.toThrow(/No patient/);
    expect((await billTo(t.db, older.id))?.id).toBe(parent.id);
    expect(await billTo(t.db, parent.id)).toBeNull();

    await owe(parent.id, 1_000);
    await owe(older.id, 3_000);
    await owe(younger.id, 2_000);
    const fam = await familyOf(t.db, t.practiceId, younger.id);
    expect(fam?.guarantorId).toBe(parent.id);
    expect(fam?.members.map((m) => [m.id, m.balanceCents])).toEqual([[parent.id, 1_000], [older.id, 3_000], [younger.id, 2_000]]);

    const first = await familyPayment(t.db, t.practiceId, older.id, 5_000, "cash", t.userId);
    expect(first).toEqual([{ patientId: parent.id, cents: 1_000 }, { patientId: older.id, cents: 3_000 }, { patientId: younger.id, cents: 1_000 }]);
    // More than the family owes: the rest is a credit on the guarantor's account.
    const second = await familyPayment(t.db, t.practiceId, younger.id, 3_000, "check");
    expect(second).toEqual([{ patientId: younger.id, cents: 1_000 }, { patientId: parent.id, cents: 2_000 }]);
    expect(await patientBalanceCents(t.db, parent.id)).toBe(-2_000);
    const methods = await t.db.select({ m: schema.ledgerEntries.paymentMethod }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.patientId, younger.id), eq(schema.ledgerEntries.type, "patient_payment")));
    expect(methods.map((r) => r.m).sort()).toEqual(["cash", "check"]);
    await expect(familyPayment(t.db, t.practiceId, (await newPatient("FAM-X")).patient.id, 100, "cash")).rejects.toThrow(/no family account/);
  });

  it("closes the day's drawer by method, and wants a note for a difference", async () => {
    const { patient } = await newPatient("CASH-1");
    const at = new Date("2026-09-15T16:00:00Z");
    const pay = (amountCents: number, paymentMethod: string | null, note: string) =>
      t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "patient_payment", amountCents, paymentMethod, note, postedAt: at });
    await pay(4_000, "cash", "Payment (cash)");
    await pay(2_500, null, "Payment (check)"); // before payment methods were recorded
    await pay(1_000, "terminal", "Card terminal");
    await pay(3_000, "card", "Payment (card)");
    await pay(7_700, "online", "Online payment");
    const totals = await dayTotals(t.db, t.practiceId, "2026-09-15");
    expect(totals).toMatchObject({ cash: 4_000, check: 2_500, card: 4_000, online: 7_700 });

    const counted = { day: "2026-09-15", countedCashCents: 3_900, countedChecksCents: 2_500, cardBatchCents: 4_000 };
    await expect(closeDay(t.db, t.practiceId, counted)).rejects.toThrow(/difference/);
    const r = await closeDay(t.db, t.practiceId, { ...counted, notes: "One dollar short; change error" }, t.userId);
    expect(r.variance).toEqual({ cash: -100, check: 0, card: 0 });
    // Closing again (the dollar turned up) updates the day rather than adding another.
    await closeDay(t.db, t.practiceId, { ...counted, countedCashCents: 4_000 });
    const rows = await t.db.select().from(schema.cashCloses).where(and(eq(schema.cashCloses.practiceId, t.practiceId), eq(schema.cashCloses.day, "2026-09-15")));
    expect(rows).toHaveLength(1);
    expect(rows[0].countedCashCents).toBe(4_000);
  });

  it("posts an agency's recovery in full and books its commission", async () => {
    const { patient } = await newPatient("AGY-1");
    await owe(patient.id, 20_000);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, type: "bad_debt", amountCents: 20_000, note: "Bad debt: placed with Acme Recovery" });
    const [c] = await t.db.insert(schema.patientCollections).values({ practiceId: t.practiceId, patientId: patient.id, stage: "agency", agency: "Acme Recovery", amountCents: 20_000, commissionPct: 30, placedAt: new Date(Date.now() - 20 * 86_400_000) }).returning();
    const before = (await periodTotals(t.db, t.practiceId, today.slice(0, 7))).agency_commission ?? 0;

    expect(await recordAgencyRecovery(t.db, t.practiceId, c.id, { receivedOn: today, grossCents: 10_000, reference: "CHK 5521" }, t.userId)).toEqual({ grossCents: 10_000, commissionCents: 3_000, netCents: 7_000 });
    expect(await patientBalanceCents(t.db, patient.id)).toBe(0); // half recovered, half still written off
    await expect(recordAgencyRecovery(t.db, t.practiceId, c.id, { receivedOn: today, grossCents: 15_000 })).rejects.toThrow(/more than was placed/);
    await expect(recordAgencyRecovery(t.db, t.practiceId, c.id, { receivedOn: today, grossCents: 1_000, commissionCents: 2_000 })).rejects.toThrow(/commission/);

    expect((await periodTotals(t.db, t.practiceId, today.slice(0, 7))).agency_commission).toBe(before + 3_000);
    const acme = (await agencyPerformance(t.db, t.practiceId)).find((a) => a.agency === "Acme Recovery");
    expect(acme).toMatchObject({ placedCents: 20_000, grossCents: 10_000, commissionCents: 3_000, netCents: 7_000, recoveryRate: 0.5, medianDaysToFirst: 20 });
  });

  it("charges missed-appointment fees under the policy, once, and waives them", async () => {
    const now = new Date();
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const appt = async (patientId: string, startsAt: Date, status: string, cancelledAt: Date | null = null) =>
      (await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId, providerId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), status, cancelledAt }).returning())[0];
    expect((await feeCandidates(t.db, t.practiceId)).policy).toBeNull();
    await expect(saveFeePolicy(t.db, t.practiceId, { noShowCents: 60_000, lateCancelCents: 0, lateCancelHours: 24 })).rejects.toThrow(/\$500/);
    await saveFeePolicy(t.db, t.practiceId, { noShowCents: 5_000, lateCancelCents: 2_500, lateCancelHours: 24 }, t.userId);

    const signed = { feePolicySignedOn: "2026-01-02" };
    const { patient: a } = await newPatient("FEE-A", commercial, signed);
    const { patient: b } = await newPatient("FEE-B", commercial, signed);
    const { patient: unsigned } = await newPatient("FEE-C");
    const { patient: onMedicaid } = await newPatient("FEE-D", medicaid, signed);
    const noShow = await appt(a.id, ago(5 * 24), "no_show");
    const late = await appt(b.id, ago(3 * 24), "cancelled", ago(3 * 24 + 2));
    const early = await appt(b.id, ago(2 * 24), "cancelled", ago(5 * 24));
    const notAgreed = await appt(unsigned.id, ago(24), "no_show");
    const medicaidVisit = await appt(onMedicaid.id, ago(24), "no_show");

    const find = async (id: string) => (await feeCandidates(t.db, t.practiceId)).candidates.find((c) => c.appointmentId === id);
    expect(await find(noShow.id)).toMatchObject({ kind: "no_show", feeCents: 5_000, blocked: null });
    expect(await find(late.id)).toMatchObject({ kind: "late_cancel", feeCents: 2_500, blocked: null });
    expect(await find(early.id)).toBeUndefined();
    expect((await find(notAgreed.id))?.blocked).toMatch(/agreed/);
    expect((await find(medicaidVisit.id))?.blocked).toMatch(/Medicaid/);
    await expect(chargeFee(t.db, t.practiceId, notAgreed.id)).rejects.toThrow(/agreed/);

    const fee = await chargeFee(t.db, t.practiceId, noShow.id, t.userId);
    expect(fee.type).toBe("patient_fee");
    await expect(chargeFee(t.db, t.practiceId, noShow.id)).rejects.toThrow(/no fee to charge/);
    expect(await patientBalanceCents(t.db, a.id)).toBe(5_000);
    const d = await buildStatementDetail(t.db, a.id);
    expect([d.feesCents, d.totals.amountDueCents]).toEqual([5_000, 5_000]);
    expect((await generateStatement(t.db, t.practiceId, a.id)).detail.feesCents).toBe(5_000);

    await expect(waiveFee(t.db, t.practiceId, fee.id, " ")).rejects.toThrow(/reason/);
    await waiveFee(t.db, t.practiceId, fee.id, "First time; car trouble", t.userId);
    await expect(waiveFee(t.db, t.practiceId, fee.id, "again")).rejects.toThrow(/already waived/);
    expect(await patientBalanceCents(t.db, a.id)).toBe(0);
    expect((await recentFees(t.db, t.practiceId)).find((f) => f.id === fee.id)).toMatchObject({ cents: 5_000, waived: true });
  });

  it("reports denial root causes, with corrections, by owner and preventable share", async () => {
    const { patient } = await newPatient("RC-1");
    const { claim } = await visit(patient.id, "2026-08-20");
    const [elig, limit] = await t.db.insert(schema.denials).values([
      { practiceId: t.practiceId, claimId: claim.id, category: "eligibility", carc: "27", amountCents: 3_000 },
      { practiceId: t.practiceId, claimId: claim.id, category: "other", carc: "96", amountCents: 1_000 },
    ]).returning();
    await expect(setRootCause(t.db, t.practiceId, limit.id, "bogus")).rejects.toThrow(/root cause/);
    await setRootCause(t.db, t.practiceId, limit.id, "authorization", t.userId);
    const r = await rootCauseReport(t.db, t.practiceId, "2026-01-01", today);
    const mine = r.items.filter((i) => i.claimId === claim.id).sort((x, y) => y.cents - x.cents);
    expect(mine.map((i) => [i.id, i.cause, i.owner, i.inferred])).toEqual([[elig.id, "eligibility", "front_desk", true], [limit.id, "authorization", "front_desk", false]]);
    expect(r.byOwner.find((o) => o.key === "front_desk")?.cents).toBeGreaterThanOrEqual(4_000);
    expect(r.preventable).toBeLessThanOrEqual(r.total);
    expect(r.byMonth.reduce((a, m) => a + m.total, 0)).toBe(r.total);
  });

  it("loads a chargemaster, prices facility lines from it, and writes the standard charges file", async () => {
    const csv = [
      "Item Code,Description,Revenue Code,HCPCS,Charge,Cash Price,Setting",
      'ct-abd,"CT abdomen and pelvis, with contrast",350,74177,"$1,850.00",900,outpatient',
      "ER-3,Emergency visit level 3,0450,99283,640.00,,both",
      "SUP-1,Supplies,270,,12.50,,",
    ].join("\n");
    expect(await importChargemaster(t.db, t.practiceId, csv, t.userId)).toBe(3);
    await expect(importChargemaster(t.db, t.practiceId, "Item Code,Description,Revenue Code,Charge\nX-1,Thing,45A,10")).rejects.toThrow(/four digits/);
    expect(await chargemasterPrice(t.db, t.practiceId, "0350", "74177")).toBe(185_000);
    expect(await chargemasterPrice(t.db, t.practiceId, "270", null)).toBe(1_250);
    expect(await chargemasterPrice(t.db, t.practiceId, "0450", "99999")).toBeNull();
    // Loading again updates items by code.
    await importChargemaster(t.db, t.practiceId, "Item Code,Description,Revenue Code,HCPCS,Charge\nER-3,Emergency visit level 3,0450,99283,700");
    expect(await chargemasterPrice(t.db, t.practiceId, "0450", "99283")).toBe(70_000);
    expect(await chargemasterStats(t.db, t.practiceId)).toEqual({ items: 3, unreviewed: 3 });
    await markReviewed(t.db, t.practiceId);
    expect((await chargemasterStats(t.db, t.practiceId)).unreviewed).toBe(0);

    const [fs] = await t.db.insert(schema.feeSchedules).values({ practiceId: t.practiceId, payerId: commercial.id, name: "Commercial contract 2026" }).returning();
    await t.db.insert(schema.feeScheduleItems).values({ feeScheduleId: fs.id, cpt: "74177", amountCents: 41_200 });
    const file = await priceTransparencyCsv(t.db, t.practiceId, { locationName: "Main campus", licenseNumber: "H-1234", licenseState: "FL" });
    const lines = file.trim().split("\n");
    expect(lines[0]).toContain("license_number | FL");
    expect(lines[1]).toContain("Main campus");
    expect(lines[2]).toContain("standard_charge | gross");
    const ct = lines.find((l) => l.startsWith('"CT abdomen and pelvis, with contrast"'));
    expect(ct).toContain("74177,CPT,0350,RC");
    expect(ct).toContain("1850.00,900.00");
    expect(ct).toContain(`${commercial.name},All plans,412.00`);
    expect(lines.find((l) => l.startsWith("Supplies,"))).toContain("0270,RC");
  });

  it("builds the compensation worksheet from the plan, collections and work RVUs", async () => {
    await expect(savePlan(t.db, t.practiceId, { providerId, kind: "collections", baseCents: 0, collectionsPct: null, perRvuCents: null, threshold: null, effectiveFrom: "2026-01-01" })).rejects.toThrow(/percentage/);
    await savePlan(t.db, t.practiceId, { providerId, kind: "collections", baseCents: 0, collectionsPct: 30, perRvuCents: null, threshold: null, effectiveFrom: "2026-01-01" }, t.userId);
    // Work RVUs come from the fee schedule's RVU file (99213: 1.3).
    await t.db.insert(schema.mpfsYears).values({ year: 2026, conversionFactor: 33.4 }).onConflictDoNothing();
    await t.db.insert(schema.mpfsRvus).values({ year: 2026, code: "99213", workRvu: 1.3, peNonFacility: 1.1, peFacility: 0.5, mpRvu: 0.1 }).onConflictDoNothing();
    const { patient } = await newPatient("COMP-1");
    const { claim } = await visit(patient.id, today);
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId: patient.id, claimId: claim.id, type: "insurance_payment", amountCents: 10_000 });
    const row = (await compensation(t.db, t.practiceId, today, today)).find((r) => r.providerId === providerId);
    expect(row?.collectionsCents).toBeGreaterThanOrEqual(10_000);
    expect(row?.wrvu).toBeGreaterThanOrEqual(1.3);
    expect(row?.payCents).toBe(Math.round(row!.collectionsCents * 0.3));
  });
});
