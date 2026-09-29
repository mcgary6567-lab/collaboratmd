import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { build271, parse271, summarize271, type Benefit } from "@/lib/edi/x270";
import { scrubClaim, type ScrubClaim } from "@/lib/scrub/rules";
import { birthdayRuleCheck } from "@/lib/cob/birthday-rule";
import { addBusinessDays, businessDaysBetween, federalHolidays, isBusinessDay } from "@/lib/business-days";
import { createEncounterWithClaim } from "./encounters";
import { loadClaimBundle, scrubBundle } from "./claims";
import { duplicateIssues } from "./duplicates";
import { closeNsaDispute, createNsaDispute, nsaDeadlineAlerts, nsaDeadlines, startIdr, startNegotiation } from "./nsa-disputes";
import { applySlidingFee, recordSlidingFee, saveGuidelines, saveTiers, slidingFeeFor } from "./sliding-fee";
import { medicaidManagedCareFinding, recheckMedicaidMonthly } from "./patients";
import { importGpcis, importRvus } from "./mpfs";
import { contractComparison, lagReport, whatIf } from "./revenue-reports";

const scrub = (over: Partial<ScrubClaim> = {}, enc: Partial<ScrubClaim["encounter"]> = {}): ScrubClaim => ({
  patient: { firstName: "Maria", lastName: "Garcia", dob: "1950-04-12", sex: "F", address1: "1 Main St", zip: "32801" },
  insurance: { memberId: "1EG4TE5MK73", payerId: "00590", relationship: "self" },
  provider: { npi: "1234567893", taxonomy: "207Q00000X" },
  practice: { npi: "1234567893", taxId: "12-3456789" },
  encounter: { dateOfService: "2026-09-01", placeOfService: "21", diagnoses: ["E11.9"], ...enc },
  lines: [{ lineNumber: 1, cpt: "99232", modifiers: [], units: 1, chargeCents: 12000, dxPointers: [1] }],
  payer: { timelyFilingDays: 365, type: "medicare" },
  today: new Date("2026-09-21T00:00:00Z"),
  ...over,
});
const rules = (c: ScrubClaim) => scrubClaim(c).map((f) => `${f.rule}:${f.severity}`);

const RVU = [
  "2026 National Physician Fee Schedule Relative Value File",
  '"HCPCS","MOD","DESCRIPTION","STATUS","WORK","NON-FAC PE","FACILITY PE","MP","MULT","GLOB","CONV"',
  '"","","","CODE","RVU","RVU","RVU","RVU","PROC","DAYS","FACTOR"',
  '"99213","","Office visit est","A","1.30","1.21","0.53","0.10","0","XXX","33.4009"',
  '"99214","","Office visit est","A","1.92","1.59","0.78","0.13","0","XXX","33.4009"',
  ...Array.from({ length: 60 }, (_, i) => `"9${String(1000 + i)}","","Filler","A","1.00","1.00","0.50","0.10","0","XXX","33.4009"`),
].join("\n");
const GPCI = [
  "Addendum E. Final CY 2026 GPCIs",
  '"Medicare Administrative Contractor (MAC)","State","Locality Number","Locality Name","2026 PW GPCI (with 1.0 Floor)","2026 PE GPCI","2026 MP GPCI"',
  '"09102","FL","04","MIAMI","1.000","1.000","1.000"',
].join("\n");

describe("pure rules", () => {
  it("flags a service already billed on another claim unless a repeat modifier explains it", () => {
    const lines = [{ lineNumber: 1, cpt: "99213", modifiers: [] }, { lineNumber: 2, cpt: "36415", modifiers: ["91"] }];
    const others = [{ claimId: "c1", controlNumber: "CMD1", status: "paid", cpt: "99213" }, { claimId: "c1", controlNumber: "CMD1", status: "paid", cpt: "36415" }];
    expect(duplicateIssues(lines, others).map((f) => `${f.rule}:${f.severity}:${f.field}`)).toEqual(["DUPLICATE_CLAIM:error:lines.1.cpt"]);
    expect(duplicateIssues(lines, [{ ...others[0], status: "denied" }])[0]).toMatchObject({ severity: "warning" });
    expect(duplicateIssues(lines, [{ ...others[0], status: "denied" }])[0].message).toMatch(/corrected claim/);
    expect(duplicateIssues(lines, [{ ...others[0], status: "ready" }])[0].severity).toBe("warning");
  });

  it("applies the birthday rule to a child on both parents' plans", () => {
    const plan = (id: string, rank: number, dob: string, over = {}) => ({ id, rank, relationship: "child", subscriberDob: dob, payerType: "commercial", payerName: `Plan ${id}`, ...over });
    expect(birthdayRuleCheck([plan("a", 1, "1980-03-10"), plan("b", 2, "1978-07-01")])).toBeNull(); // March before July: right order
    expect(birthdayRuleCheck([plan("a", 1, "1975-11-02"), plan("b", 2, "1990-02-14")])).toMatchObject({ expectedPrimaryId: "b" }); // the year does not matter
    expect(birthdayRuleCheck([plan("a", 1, "1975-11-02"), plan("b", 2, "1990-11-02")])).toBeNull(); // same birthday: cannot tell
    expect(birthdayRuleCheck([plan("a", 1, "1975-11-02", { relationship: "self" }), plan("b", 2, "1990-02-14")])).toBeNull();
    expect(birthdayRuleCheck([plan("a", 1, "1975-11-02"), plan("b", 2, "1990-02-14", { payerType: "medicaid" })])).toBeNull();
  });

  it("counts business days around federal holidays", () => {
    const h = federalHolidays(2026);
    for (const d of ["2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25"]) expect(h.has(d)).toBe(true);
    expect(h.has("2026-07-04")).toBe(false); // a Saturday: observed the Friday before
    expect(federalHolidays(2027).has("2027-12-31")).toBe(true); // January 1, 2028 is a Saturday
    expect(isBusinessDay("2026-07-03")).toBe(false);
    expect(addBusinessDays("2026-07-02", 1)).toBe("2026-07-06");
    expect(businessDaysBetween("2026-07-02", "2026-07-06")).toBe(1);
    expect(nsaDeadlines({ initialResponseOn: "2026-09-01", negotiationStartedOn: null }).startBy).toBe("2026-10-15"); // skips Labor Day and Columbus Day
    const d = nsaDeadlines({ initialResponseOn: "2026-09-01", negotiationStartedOn: "2026-09-10" });
    expect(d.negotiationEnds).toBe(addBusinessDays("2026-09-10", 30));
    expect(d.idrBy).toBe(addBusinessDays(d.negotiationEnds!, 4));
  });

  it("puts a household on the sliding fee scale", () => {
    const g = { baseCents: 1_500_000, perPersonCents: 500_000 };
    const tiers = [{ maxPercent: 100, discountPercent: 100 }, { maxPercent: 150, discountPercent: 75 }, { maxPercent: 200, discountPercent: 50 }];
    expect(slidingFeeFor(g, tiers, 3, 2_500_000)).toEqual({ percent: 100, discountPercent: 100 }); // guideline for 3 is $25,000
    expect(slidingFeeFor(g, tiers, 3, 3_700_000)).toEqual({ percent: 148, discountPercent: 75 });
    expect(slidingFeeFor(g, tiers, 1, 4_000_000)).toEqual({ percent: 266, discountPercent: 0 });
    expect(whatIf({ allowedCents: 10_000, medicareCents: 10_000 }, 120)).toEqual({ projectedCents: 12_000, differenceCents: 2_000 });
  });

  it("checks split/shared visits and teaching-physician modifiers", () => {
    const shared = { sharedWith: { npi: "9876543213", name: "Pat Lee" } };
    expect(rules(scrub({}, { ...shared, substantiveAttested: true }))).toContain("SPLIT_SHARED:error"); // no FS
    expect(rules(scrub({ lines: [{ lineNumber: 1, cpt: "99232", modifiers: ["FS"], units: 1, chargeCents: 12000, dxPointers: [1] }] }, { ...shared, substantiveAttested: true })).filter((r) => r.startsWith("SPLIT"))).toEqual([]);
    expect(rules(scrub({ lines: [{ lineNumber: 1, cpt: "99232", modifiers: ["FS"], units: 1, chargeCents: 12000, dxPointers: [1] }] }, shared))).toContain("SPLIT_SHARED:error"); // not attested
    expect(rules(scrub({ lines: [{ lineNumber: 1, cpt: "99213", modifiers: ["FS"], units: 1, chargeCents: 12000, dxPointers: [1] }] }, { ...shared, substantiveAttested: true, placeOfService: "11" }))).toContain("SPLIT_SHARED:warning"); // office
    expect(rules(scrub({ lines: [{ lineNumber: 1, cpt: "99232", modifiers: ["FS"], units: 1, chargeCents: 12000, dxPointers: [1] }] }))).toContain("SPLIT_SHARED:warning"); // FS with nobody named
    const line = (mods: string[], cpt = "99213") => [{ lineNumber: 1, cpt, modifiers: mods, units: 1, chargeCents: 12000, dxPointers: [1] }];
    expect(rules(scrub({ lines: line(["GC"]) }))).toContain("TEACHING:error");
    expect(rules(scrub({ lines: line(["GC"]) }, { teachingPresent: true })).filter((r) => r.startsWith("TEACHING"))).toEqual([]);
    expect(rules(scrub({ lines: line(["GC", "GE"]) }, { teachingPresent: true }))).toContain("TEACHING:error");
    expect(rules(scrub({ lines: line(["GE"]) })).filter((r) => r.startsWith("TEACHING"))).toEqual([]);
    expect(rules(scrub({ lines: line(["GE"], "99215") }))).toContain("TEACHING:warning");
  });

  it("finds a Medicaid managed care plan in a 271", () => {
    const benefit = (over: Partial<Benefit>): Benefit => ({ code: "1", coverageLevel: "IND", serviceType: "30", insuranceType: "MC", planDescription: "", timePeriod: "", amountCents: null, percent: null, inNetwork: "", ...over });
    const inquiry = { traceNumber: "T1", payerId: "77027", payerName: "FLORIDA MEDICAID", providerNpi: "1234567893", providerName: "Clinic", memberId: "M1", lastName: "DOE", firstName: "JO", dob: "2015-01-01", sex: "F", serviceDate: "2026-09-20", serviceTypes: ["30"] };
    const raw = build271({ senderId: "S", receiverId: "R", now: new Date("2026-09-20T12:00:00Z"), control: "1", inquiry, benefits: [benefit({}), benefit({ code: "U" })] })
      .replace(/(EB\*U\*[^~]*~)/, "$1LS*2120~NM1*Y2*2*SUNSHINE HEALTH*****PI*68069~LE*2120~");
    expect(summarize271(parse271(raw)).managedCare).toEqual({ plan: "SUNSHINE HEALTH", payerId: "68069" });
    expect(summarize271(parse271(build271({ senderId: "S", receiverId: "R", now: new Date(), control: "1", inquiry, benefits: [benefit({})] }))).managedCare).toBeUndefined();
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let otherProviderId: string;
  let patientId: string;
  beforeAll(async () => {
    t = await testDb();
    const provs = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(2);
    [providerId, otherProviderId] = [provs[0].id, provs[1].id];
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    patientId = p.id;
  });
  afterAll(async () => { await t?.close(); });

  const visit = (over: Partial<Parameters<typeof createEncounterWithClaim>[2]> = {}) => createEncounterWithClaim(t.db, t.practiceId, {
    patientId, providerId, dateOfService: "2026-09-03", placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 12_000, dxPointers: [1] }], ...over,
  });

  it("stops the same service billed twice to the same payer", async () => {
    const first = await visit();
    await t.db.update(schema.claims).set({ status: "paid" }).where(eq(schema.claims.id, first.claim.id));
    const second = await visit({ providerId: otherProviderId });
    const { findings } = await scrubBundle(t.db, (await loadClaimBundle(t.db, second.claim.id))!);
    expect(findings.find((f) => f.rule === "DUPLICATE_CLAIM")?.message).toContain(first.claim.controlNumber);
    const repeat = await visit({ lines: [{ cpt: "99213", modifiers: ["77"], units: 1, chargeCents: 12_000, dxPointers: [1] }] });
    expect((await scrubBundle(t.db, (await loadClaimBundle(t.db, repeat.claim.id))!)).findings.filter((f) => f.rule === "DUPLICATE_CLAIM")).toEqual([]);
  });

  it("adds FS to a split/shared visit and records the teaching attestation", async () => {
    const { encounter } = await visit({ dateOfService: "2026-09-04", placeOfService: "21", sharedWithProviderId: otherProviderId, substantiveAttested: true, teachingPresent: true, lines: [{ cpt: "99232", modifiers: [], units: 1, chargeCents: 15_000, dxPointers: [1] }] });
    const [line] = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, encounter.id));
    expect(line.modifiers).toEqual(["FS"]);
    expect(encounter).toMatchObject({ sharedWithProviderId: otherProviderId, substantiveAttested: true, teachingPresent: true });
    await expect(visit({ sharedWithProviderId: providerId })).rejects.toThrow(/another practitioner/);
  });

  it("keeps the No Surprises Act deadlines for a dispute", async () => {
    const { claim } = await visit({ dateOfService: "2026-08-20" });
    const d = await createNsaDispute(t.db, t.practiceId, { claimControlNumber: claim.controlNumber, initialResponseOn: "2026-09-01", offerCents: 30_000 }, t.userId);
    expect((await nsaDeadlineAlerts(t.db, t.practiceId, new Date("2026-10-12T12:00:00Z"))).dueSoon).toBeGreaterThanOrEqual(1);
    expect(await startNegotiation(t.db, t.practiceId, d.id, "2026-09-10", t.userId)).toEqual({ late: false });
    const ends = addBusinessDays("2026-09-10", 30);
    await expect(startIdr(t.db, t.practiceId, d.id, ends, t.userId)).rejects.toThrow(/only after open negotiation ends/);
    expect(await startIdr(t.db, t.practiceId, d.id, addBusinessDays(ends, 1), t.userId)).toEqual({ late: false });
    await closeNsaDispute(t.db, t.practiceId, d.id, { outcome: "IDR decided for us", settledCents: 45_000 }, t.userId);
    const [row] = await t.db.select().from(schema.nsaDisputes).where(eq(schema.nsaDisputes.id, d.id));
    expect(row).toMatchObject({ status: "settled", settledCents: 45_000 });
  });

  it("discounts what an eligible patient owes by their sliding fee tier, once", async () => {
    await expect(recordSlidingFee(t.db, t.practiceId, patientId, { householdSize: 2, annualIncomeCents: 1_000_000, proof: "Tax return", verifiedOn: "2026-09-01" })).rejects.toThrow(/poverty guidelines/);
    await saveGuidelines(t.db, t.practiceId, { year: 2026, baseCents: 1_500_000, perPersonCents: 500_000 });
    await saveTiers(t.db, t.practiceId, [{ maxPercent: 100, discountPercent: 100 }, { maxPercent: 200, discountPercent: 50 }]);
    const { claim } = await visit({ dateOfService: "2026-09-05" });
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId, claimId: claim.id, type: "transfer_to_patient", amountCents: 4_000, note: "PR-2" });
    const r = await recordSlidingFee(t.db, t.practiceId, patientId, { householdSize: 2, annualIncomeCents: 3_000_000, proof: "2025 tax return", verifiedOn: new Date().toISOString().slice(0, 10) }, t.userId);
    expect(r).toMatchObject({ percent: 150, discountPercent: 50 });
    const discounts = async () => (await t.db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.claimId, claim.id), eq(schema.ledgerEntries.type, "discount")))).reduce((a, e) => a + e.amountCents, 0);
    expect(await discounts()).toBe(2_000);
    expect(await applySlidingFee(t.db, t.practiceId, patientId)).toBe(0); // already applied
    expect(await discounts()).toBe(2_000);
  });

  it("stops a claim to state Medicaid for a patient in a managed care plan that month, and re-checks monthly", async () => {
    const [medicaid] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "medicaid"))).limit(1);
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: "MCD-1", firstName: "Jo", lastName: "Medicaid", dob: "2015-01-01", sex: "F" }).returning();
    const [ins] = await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: medicaid.id, memberId: "MCD12345", relationship: "self" }).returning();
    await t.db.insert(schema.eligibilityChecks).values({ patientInsuranceId: ins.id, status: "active", serviceDate: "2026-09-02", response: { transaction: "271", status: "active", managedCare: { plan: "SUNSHINE HEALTH", payerId: "68069" } } });
    expect((await medicaidManagedCareFinding(t.db, { patientInsuranceId: ins.id, payerType: "medicaid", dateOfService: "2026-09-20" }))?.message).toMatch(/SUNSHINE HEALTH/);
    expect(await medicaidManagedCareFinding(t.db, { patientInsuranceId: ins.id, payerType: "medicaid", dateOfService: "2026-10-02" })).toBeNull(); // another month
    const at = new Date(Date.now() + 5 * 86_400_000);
    at.setUTCHours(15, 0, 0, 0);
    await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: p.id, providerId, startsAt: at, endsAt: new Date(at.getTime() + 1_800_000) });
    await t.db.delete(schema.eligibilityChecks).where(eq(schema.eligibilityChecks.patientInsuranceId, ins.id));
    const first = await recheckMedicaidMonthly(t.db, t.practiceId);
    expect(first.checked).toBeGreaterThanOrEqual(1);
    const [checked] = await t.db.select().from(schema.eligibilityChecks).where(eq(schema.eligibilityChecks.patientInsuranceId, ins.id));
    expect(checked).toBeTruthy();
    // Checked this month already: not asked again.
    const again = await recheckMedicaidMonthly(t.db, t.practiceId);
    expect(again.checked).toBeLessThan(first.checked);
  });

  it("compares a payer's allowed amounts with Medicare, and measures lag", async () => {
    expect((await contractComparison(t.db, t.practiceId, "2026-01-01", "2026-12-31")).ready).toBe(false);
    await importRvus(t.db, RVU, 2026, "PPRRVU26", "test");
    await importGpcis(t.db, GPCI, 2026, "GPCI26", "test");
    await t.db.update(schema.practices).set({ medicareCarrier: "09102", medicareLocality: "04" }).where(eq(schema.practices.id, t.practiceId));
    const [commercial] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
    const before = await contractComparison(t.db, t.practiceId, "2026-06-01", "2026-06-30");
    const base = (before.ready && before.payers.find((x) => x.payerId === commercial.id)) || { medicareCents: 0, allowedCents: 0, claims: 0 };
    const [cp] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: "CMP-1", firstName: "Cora", lastName: "Contract", dob: "1980-01-01", sex: "F" }).returning();
    await t.db.insert(schema.patientInsurances).values({ patientId: cp.id, payerId: commercial.id, memberId: "CM12345A", relationship: "self" });
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, { patientId: cp.id, providerId, dateOfService: "2026-06-10", placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 15_000, dxPointers: [1] }] });
    await t.db.update(schema.claims).set({ status: "paid" }).where(eq(schema.claims.id, claim.id));
    const medicare = Math.round((1.3 + 1.21 + 0.1) * 33.4009 * 100); // GPCIs of 1.000
    await t.db.insert(schema.ledgerEntries).values([
      { practiceId: t.practiceId, patientId: cp.id, claimId: claim.id, type: "insurance_payment", amountCents: medicare, note: "paid" },
      { practiceId: t.practiceId, patientId: cp.id, claimId: claim.id, type: "transfer_to_patient", amountCents: Math.round(medicare * 0.2), note: "PR" },
    ]);
    const r = await contractComparison(t.db, t.practiceId, "2026-06-01", "2026-06-30");
    if (!r.ready) throw new Error(r.reason);
    const row = r.payers.find((x) => x.payerId === commercial.id)!;
    expect(row.claims - base.claims).toBe(1);
    expect(row.medicareCents - base.medicareCents).toBe(medicare);
    expect(row.allowedCents - base.allowedCents).toBe(medicare + Math.round(medicare * 0.2)); // 120% of Medicare
    expect(row.percentOfMedicare).toBe(Math.round((row.allowedCents / row.medicareCents) * 1000) / 10);
    const lag = await lagReport(t.db, t.practiceId, "2026-01-01", "2026-12-31");
    expect(lag.find((l) => l.providerId === providerId)?.visits).toBeGreaterThan(0);
    for (const l of lag) {
      expect(l.chargeAvg ?? 0).toBeGreaterThanOrEqual(0);
      expect(l.submitAvg ?? 0).toBeGreaterThanOrEqual(0); // imported history with late timestamps never reads negative
    }
  });
});
