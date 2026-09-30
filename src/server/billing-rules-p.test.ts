import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { explainShare } from "@/lib/billing/explain";
import { createEncounterWithClaim } from "./encounters";
import { icdFindings, importIcd10, importIcd10Addenda, parseIcd10, parseIcd10Addenda } from "./code-catalog";
import { ICD10CM_RE } from "@/lib/codes/icd";
import { scrubClaim } from "@/lib/scrub/rules";
import { codeChanges } from "./code-changes";
import { accountingOfDisclosures, completeAccessRequest, createAccessRequest, extendAccessRequest, recordDisclosure } from "./disclosures";
import { createRecordsRequest, markRecordsSent } from "./records-requests";
import { saveUnclaimedSettings } from "./policies";
import { markLetterSent, markReported, scanUnclaimed, unclaimedCases } from "./unclaimed";
import { patientBalanceCents } from "./billing";
import { patientsWithPayments, yearReceipt } from "./receipts";
import { contractCalendar, contractReminders, saveContractDates } from "./contract-calendar";
import { benefitsToDate } from "./accumulators";
import { orderingFindings, orderingNeed, parseOrderingReferring } from "./ordering";
import { shareReasons } from "./remittance-lines";

/** A line of CMS's order file: order number, code, billable flag, short and long descriptions in fixed columns. */
const orderLine = (n: number, code: string, flag: 0 | 1, desc: string) => `${String(n).padStart(5, "0")} ${code.padEnd(7)} ${flag} ${desc.padEnd(60)} ${desc}`;
const addendaLine = (kind: "Add" | "Delete", flag: 0 | 1, code: string, desc: string) => `${`${kind}:`.padEnd(12)} ${flag} ${code.padEnd(7)} ${desc.padEnd(60)} ${desc}`;

/** FY 2027: E11.9 unchanged, I42.0 deleted (split into I42.00 and I42.09), D69.1 now a category, C78.31 new. */
function fy2027() {
  const codes: [string, 0 | 1, string][] = [
    ["E119", 1, "Type 2 diabetes mellitus without complications"], ["I10", 1, "Essential (primary) hypertension"],
    ["I4200", 1, "Dilated cardiomyopathy, unspecified"], ["I4209", 1, "Other dilated cardiomyopathy"],
    ["D691", 0, "Qualitative platelet defects"], ["D6911", 1, "Glanzmann thrombasthenia"], ["D6919", 1, "Other qualitative platelet defects"],
    ["C7831", 1, "Secondary malignant neoplasm of larynx"],
  ];
  for (let i = 100; i < 230; i++) codes.push([`T${i}0`, 1, `Filler code ${i}`]);
  const order = codes.map(([c, f, d], i) => orderLine(i + 1, c, f, d)).join("\n");
  const addenda = [
    addendaLine("Add", 1, "C7831", "Secondary malignant neoplasm of larynx"),
    addendaLine("Delete", 1, "D691", "Qualitative platelet defects"),
    addendaLine("Add", 0, "D691", "Qualitative platelet defects"),
    addendaLine("Add", 1, "D6911", "Glanzmann thrombasthenia"),
    addendaLine("Add", 1, "D6919", "Other qualitative platelet defects"),
    addendaLine("Delete", 1, "I420", "Dilated cardiomyopathy"),
    addendaLine("Add", 1, "I4200", "Dilated cardiomyopathy, unspecified"),
    addendaLine("Add", 1, "I4209", "Other dilated cardiomyopathy"),
  ].join("\n");
  return { order, addenda };
}

const rulesOf = (f: { rule: string; severity: string }[]) => f.map((x) => `${x.rule}:${x.severity}`);

describe("pure parts", () => {
  it("explains what the patient owes in plain words, in English and Spanish", () => {
    expect(explainShare([{ reason: "1", amountCents: 5_000 }, { reason: "2", amountCents: 1_000 }, { reason: "1", amountCents: 500 }], "en", true, 6_500)).toEqual([
      "$55.00 went toward your plan's deductible, the amount you pay each year before your plan starts to pay.",
      "$10.00 is your coinsurance, your share of the cost once the deductible is met.",
    ]);
    expect(explainShare([{ reason: "3", amountCents: 2_500 }], "es")[0]).toBe("$25.00 es su copago por esta visita.");
    expect(explainShare([{ reason: "3", amountCents: 2_500 }], "en", true, 1_000)[1]).toContain("bring what you owe for this visit to $10.00");
    expect(explainShare([{ reason: "B9", amountCents: 700 }])[0]).toBe("$7.00 is your share under your plan (payer reason B9).");
    expect(explainShare([], "en", false)[0]).toContain("No insurance was billed");
    expect(explainShare([], "en", true, 4_000)).toEqual([]);
  });

  it("accepts every ICD-10-CM code shape: U codes, and FY 2027's two-letter QA chapter", () => {
    for (const dx of ["U07.1", "U09.9", "QA0.0101", "QA00101", "C4A.9", "S72.001A", "E11.9"]) expect(ICD10CM_RE.test(dx)).toBe(true);
    for (const dx of ["11.9", "E1", "E11.99999", "E-11"]) expect(ICD10CM_RE.test(dx)).toBe(false);
    const parsed = parseIcd10([orderLine(1, "QA0", 0, "Neurodevelopmental disorders"), orderLine(2, "QA00101", 1, "SCN2A-related neurodevelopmental disorder")].join("\n"));
    expect(parsed).toEqual({ rows: [{ code: "QA0", description: "Neurodevelopmental disorders", billable: false }, { code: "QA0.0101", description: "SCN2A-related neurodevelopmental disorder", billable: true }], skipped: 0 });
    const scrubbed = scrubClaim({
      patient: { firstName: "Maria", lastName: "Garcia", dob: "1950-04-12", sex: "F", address1: "1 Main St", zip: "32801" },
      insurance: { memberId: "ABC123", payerId: "00590", relationship: "self" }, provider: { npi: "1234567893", taxonomy: "207Q00000X" }, practice: { npi: "1234567893", taxId: "12-3456789" },
      encounter: { dateOfService: "2026-10-02", placeOfService: "11", diagnoses: ["QA0.0101", "U09.9"] },
      lines: [{ lineNumber: 1, cpt: "99213", modifiers: [], units: 1, chargeCents: 20_000, dxPointers: [1, 2] }], payer: { timelyFilingDays: 365, type: "commercial" }, today: new Date("2026-10-05T00:00:00Z"),
    });
    expect(scrubbed.filter((f) => f.field?.includes("diagnos"))).toEqual([]);
  });

  it("reads CMS's addenda and the Order and Referring file, and knows which services need an orderer", () => {
    const changes = parseIcd10Addenda(fy2027().addenda);
    expect(changes).toHaveLength(8);
    expect(changes[1]).toEqual({ kind: "delete", code: "D69.1", billable: true, description: "Qualitative platelet defects" });
    const o = parseOrderingReferring("NPI,LAST_NAME,FIRST_NAME,PARTB,DME,HHA,PMD,HOSPICE\n1234567893,SMITH,JANE,Y,N,Y,N,N\nbad,ROW,,Y,Y,Y,Y,Y\n");
    expect(o).toEqual({ rows: [{ npi: "1234567893", lastName: "SMITH", firstName: "JANE", partB: true, dme: false, hha: true, pmd: false, hospice: false }], skipped: 1 });
    expect([orderingNeed("80053"), orderingNeed("71046"), orderingNeed("E0601"), orderingNeed("A4253"), orderingNeed("99213"), orderingNeed("J1100")]).toEqual(["partB", "partB", "dme", "dme", null, null]);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  let commercial: typeof schema.payers.$inferSelect;
  const newPatient = async (mrn: string) => {
    const [p] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn, firstName: "Test", lastName: mrn, dob: "1970-01-01", sex: "F", address1: "1 Main St", city: "Orlando", state: "FL", zip: "32801" }).returning();
    const [ins] = await t.db.insert(schema.patientInsurances).values({ patientId: p.id, payerId: commercial.id, memberId: `${mrn.replace(/\W/g, "")}A`, relationship: "self" }).returning();
    return { patient: p, ins };
  };
  const visit = (patientId: string, dateOfService: string, diagnoses: string[]) =>
    createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, dateOfService, placeOfService: "11", diagnoses, lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 12_000, dxPointers: [1] }] });

  beforeAll(async () => {
    t = await testDb();
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    [commercial] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
  });
  afterAll(async () => { await t?.close(); });

  it("checks each date of service against its own ICD-10-CM year once the addenda are loaded, and lists the practice's changed codes", async () => {
    const { order, addenda } = fy2027();
    await importIcd10(t.db, order, 2027, "icd10cm_order_2027.txt", "test");
    // With only the new year loaded, the year before is unknown: a September visit is not refused, a code missing from FY 2027 only warns.
    expect(rulesOf(await icdFindings(t.db, "2026-09-30", ["E11.9"]))).toEqual([]);
    expect(rulesOf(await icdFindings(t.db, "2026-09-30", ["I42.0"]))).toEqual(["DX_CODE:warning"]);
    const r = await importIcd10Addenda(t.db, addenda, 2027, "icd10cm_order_addenda_2027.txt", "test");
    expect(r).toMatchObject({ added: 5, deleted: 1, flagChanged: 1 });

    expect(rulesOf(await icdFindings(t.db, "2026-09-30", ["E11.9", "I42.0", "D69.1"]))).toEqual([]);
    expect(rulesOf(await icdFindings(t.db, "2026-10-01", ["I42.0"]))).toEqual(["DX_DELETED:error"]);
    const cat = await icdFindings(t.db, "2026-10-01", ["D69.1"]);
    expect(cat[0].message).toContain("became a category on October 1, 2026");
    expect(rulesOf(await icdFindings(t.db, "2026-09-30", ["C78.31"]))).toEqual(["DX_NOT_YET_VALID:error"]);
    expect(rulesOf(await icdFindings(t.db, "2026-10-01", ["C78.31", "I42.09"]))).toEqual([]);
    // Before the earliest year the files describe, unknown codes are flagged, not refused.
    expect(rulesOf(await icdFindings(t.db, "2025-06-01", ["Z99.99"]))).toEqual(["DX_CODE:warning"]);

    const { patient } = await newPatient("ICD-1");
    const { claim } = await visit(patient.id, "2026-10-02", ["I42.0"]);
    await visit(patient.id, "2026-08-01", ["D69.1"]);
    const report = await codeChanges(t.db, t.practiceId);
    expect(report.year).toBe(2027);
    expect(report.totalChanges).toBe(2);
    const i420 = report.changes.find((c) => c.code === "I42.0")!;
    expect(i420).toMatchObject({ change: "deleted", openVisits: 1 });
    expect(i420.openClaims.map((c) => c.claimId)).toEqual([claim.id]);
    expect(i420.replacements.map((x) => x.code)).toEqual(["I42.00", "I42.09"]);
    const d691 = report.changes.find((c) => c.code === "D69.1")!;
    expect(d691).toMatchObject({ change: "category", openVisits: 0, recentVisits: 1 });
    expect(d691.replacements.map((x) => x.code)).toEqual(["D69.11", "D69.19"]);
  });

  it("keeps a disclosure log, puts only accountable disclosures in the accounting, and tracks patients' requests", async () => {
    const { patient } = await newPatient("PRIV-1");
    await recordDisclosure(t.db, t.practiceId, { patientId: patient.id, disclosedOn: "2026-05-01", recipient: "County health department", purpose: "public_health", description: "Reportable condition" });
    await recordDisclosure(t.db, t.practiceId, { patientId: patient.id, disclosedOn: "2019-05-01", recipient: "Court", purpose: "judicial", description: "Subpoenaed records" });
    const { claim } = await visit(patient.id, "2026-08-03", ["E11.9"]);
    const req = await createRecordsRequest(t.db, t.practiceId, { kind: "adr", claimControlNumber: claim.controlNumber, receivedOn: "2026-09-01" });
    await markRecordsSent(t.db, t.practiceId, req.id, { sentOn: "2026-09-10", sentVia: "esMD" });
    const log = await t.db.select().from(schema.disclosures).where(eq(schema.disclosures.patientId, patient.id));
    expect(log.map((d) => d.purpose).sort()).toEqual(["judicial", "payment", "public_health"]);
    const acct = await accountingOfDisclosures(t.db, t.practiceId, patient.id, "2026-09-29");
    // Payment is left out, and the court order is more than six years old.
    expect(acct.rows.map((d) => d.recipient)).toEqual(["County health department"]);
    await expect(recordDisclosure(t.db, t.practiceId, { patientId: patient.id, disclosedOn: "2026-05-01", recipient: "X", purpose: "gossip", description: "Y" })).rejects.toThrow(/purpose/);

    const copy = await createAccessRequest(t.db, t.practiceId, { patientId: patient.id, kind: "copy", receivedOn: "2026-09-01", deliverTo: "patient@example.test" });
    expect(copy.dueOn).toBe("2026-10-01");
    const ext = await extendAccessRequest(t.db, t.practiceId, copy.id, "Records are in off-site storage", "2026-09-20");
    expect(ext.dueOn).toBe("2026-10-31");
    await expect(extendAccessRequest(t.db, t.practiceId, copy.id, "Again", "2026-09-21")).rejects.toThrow(/only once/);
    await completeAccessRequest(t.db, t.practiceId, copy.id, { completedOn: "2026-10-05", feeCents: 650 });
    expect((await t.db.select().from(schema.disclosures).where(and(eq(schema.disclosures.patientId, patient.id), eq(schema.disclosures.purpose, "to_patient")))).length).toBe(1);

    const acc = await createAccessRequest(t.db, t.practiceId, { patientId: patient.id, kind: "accounting", receivedOn: "2026-09-01" });
    expect(acc.dueOn).toBe("2026-10-31");
    await expect(completeAccessRequest(t.db, t.practiceId, acc.id, { completedOn: "2026-09-15", feeCents: 1_000 })).rejects.toThrow(/first accounting/);

    // Another practice cannot act on this one's requests or patients.
    const [other] = await t.db.insert(schema.practices).values({ name: "Other", taxId: "55-5555555", npi: "5555555553", address1: "5 Elm", city: "Austin", state: "TX", zip: "78701" }).returning();
    await expect(completeAccessRequest(t.db, other.id, acc.id, { completedOn: "2026-09-15", feeCents: 0 })).rejects.toThrow(/not found/);
    await expect(recordDisclosure(t.db, other.id, { patientId: patient.id, disclosedOn: "2026-05-01", recipient: "X", purpose: "judicial", description: "Y" })).rejects.toThrow(/not found/);
  });

  it("sends dormant credits a letter, then reports them to the state, and leaves that out of the patient's receipt", async () => {
    const { patient } = await newPatient("UNC-1");
    const old = new Date("2024-03-15T15:00:00Z");
    await t.db.insert(schema.ledgerEntries).values([
      { practiceId: t.practiceId, patientId: patient.id, type: "patient_payment", amountCents: 8_000, note: "Card", postedAt: old },
      { practiceId: t.practiceId, patientId: patient.id, type: "transfer_to_patient", amountCents: 5_000, note: "PR", postedAt: old },
    ]);
    const now = new Date("2026-09-29T12:00:00Z");
    expect((await scanUnclaimed(t.db, t.practiceId, now)).configured).toBe(false);
    await saveUnclaimedSettings(t.db, t.practiceId, { state: "FL", dormancyMonths: 12, letterMinCents: 5_000 });
    // $30 is below the $50 letter minimum: straight to the report.
    let cases = (await scanUnclaimed(t.db, t.practiceId, now)).cases.filter((c) => c.patientId === patient.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ amountCents: 3_000, status: "to_report", readyToReport: true });
    await saveUnclaimedSettings(t.db, t.practiceId, { state: "FL", dormancyMonths: 12, letterMinCents: 1_000 });
    await t.db.delete(schema.unclaimedCredits).where(eq(schema.unclaimedCredits.patientId, patient.id));
    cases = (await scanUnclaimed(t.db, t.practiceId, now)).cases.filter((c) => c.patientId === patient.id);
    expect(cases[0]).toMatchObject({ status: "letter_due", readyToReport: false });
    await expect(markReported(t.db, t.practiceId, cases[0].id, 2026, undefined, now)).rejects.toThrow(/letter first/);
    await markLetterSent(t.db, t.practiceId, cases[0].id, "2026-09-20");
    await expect(markReported(t.db, t.practiceId, cases[0].id, 2026, undefined, now)).rejects.toThrow(/30 days/);
    await markLetterSent(t.db, t.practiceId, cases[0].id, "2026-08-01");
    await markReported(t.db, t.practiceId, cases[0].id, 2026, undefined, now);
    expect(await patientBalanceCents(t.db, patient.id)).toBe(0);
    expect((await unclaimedCases(t.db, t.practiceId, now)).some((c) => c.patientId === patient.id)).toBe(false);

    const r2024 = await yearReceipt(t.db, t.practiceId, patient.id, 2024);
    expect(r2024).toMatchObject({ paidCents: 8_000, refundedCents: 0, netCents: 8_000 });
    const r2026 = await yearReceipt(t.db, t.practiceId, patient.id, 2026);
    expect(r2026.refunds).toEqual([]);
    expect((await patientsWithPayments(t.db, t.practiceId, 2024)).find((p) => p.patientId === patient.id)?.paidCents).toBe(8_000);
  });

  it("keeps contract dates, sorts by the next notice date, and reminds once per step", async () => {
    const [contract] = await t.db.insert(schema.feeSchedules).values({ practiceId: t.practiceId, payerId: commercial.id, name: "Commercial 2026" }).returning();
    const [standard] = await t.db.insert(schema.feeSchedules).values({ practiceId: t.practiceId, payerId: null, name: "Standard" }).returning();
    await expect(saveContractDates(t.db, t.practiceId, standard.id, { renewsOn: "2027-01-01", noticeDays: "90", escalatorPct: "", termsNotes: "" })).rejects.toThrow(/not found/);
    await expect(saveContractDates(t.db, t.practiceId, contract.id, { renewsOn: "2027-01-01", noticeDays: "900", escalatorPct: "", termsNotes: "" })).rejects.toThrow(/Notice/);
    await saveContractDates(t.db, t.practiceId, contract.id, { renewsOn: "2027-01-01", noticeDays: "90", escalatorPct: "3", termsNotes: "Auto-renews for a year" });
    const cal = await contractCalendar(t.db, t.practiceId, "2026-09-29");
    expect(cal[0]).toMatchObject({ scheduleId: contract.id, noticeBy: "2026-10-03", daysToNotice: 4, escalatorPct: 3 });
    expect(await contractReminders(t.db, t.practiceId, "2026-09-29")).toBe(1);
    await contractReminders(t.db, t.practiceId, "2026-09-30");
    const notes = await t.db.select().from(schema.notifications).where(and(eq(schema.notifications.practiceId, t.practiceId), eq(schema.notifications.kind, "contract_notice")));
    expect(notes).toHaveLength(1);
  });

  it("keeps the deductible and out-of-pocket left current from the payer's 835s, starting over in a new year", async () => {
    const { patient, ins } = await newPatient("ACC-1");
    const { claim } = await visit(patient.id, "2026-08-05", ["E11.9"]);
    await t.db.update(schema.claims).set({ patientInsuranceId: ins.id }).where(eq(schema.claims.id, claim.id));
    await t.db.insert(schema.eligibilityChecks).values({ patientInsuranceId: ins.id, status: "active", deductibleCents: 150_000, deductibleRemainingCents: 100_000, oopMaxCents: 500_000, oopRemainingCents: 400_000, checkedAt: new Date("2026-06-01T12:00:00Z") });
    const [remit] = await t.db.insert(schema.remittances).values({ practiceId: t.practiceId, payerId: commercial.id, payerName: commercial.name, checkNumber: "ACC-EFT", amountCents: 0, paymentDate: "2026-08-20", raw835: "" }).returning();
    await t.db.insert(schema.remittanceLines).values({
      practiceId: t.practiceId, remittanceId: remit.id, claimId: claim.id, payerId: commercial.id, cpt: "99213", units: 1, chargedCents: 40_000, allowedCents: 30_000, paidCents: 0, paymentDate: "2026-08-20",
      adjustments: [{ group: "CO", reason: "45", amountCents: 10_000 }, { group: "PR", reason: "1", amountCents: 25_000 }, { group: "PR", reason: "2", amountCents: 5_000 }],
    });
    expect(await benefitsToDate(t.db, ins.id, "2026-09-29")).toMatchObject({ newPlanYear: false, appliedDeductibleCents: 25_000, appliedOopCents: 30_000, deductibleRemainingCents: 75_000, oopRemainingCents: 370_000 });
    // Before the 835 arrived, nothing was applied yet.
    expect((await benefitsToDate(t.db, ins.id, "2026-08-01"))?.deductibleRemainingCents).toBe(100_000);
    expect(await benefitsToDate(t.db, ins.id, "2027-01-10")).toMatchObject({ newPlanYear: true, deductibleRemainingCents: 150_000, oopRemainingCents: 500_000 });
    const reasons = await shareReasons(t.db, [claim.id]);
    expect(explainShare(reasons.get(claim.id)!, "en", true, 30_000)).toHaveLength(2);
  });

  it("stops Medicare lab, imaging and equipment lines whose orderer is not enrolled to order them", async () => {
    const base = { payerType: "medicare", placeOfService: "11", referringName: "Jane Smith" };
    const lab = [{ lineNumber: 1, cpt: "80053" }];
    // Nothing loaded: no check beyond the missing orderer where one is expected.
    expect(await orderingFindings(t.db, { ...base, referringNpi: "1234567893", lines: lab })).toEqual([]);
    expect(rulesOf(await orderingFindings(t.db, { ...base, placeOfService: "81", referringNpi: null, lines: lab }))).toEqual(["ORDERING_MISSING:warning"]);
    expect(await orderingFindings(t.db, { ...base, referringNpi: null, lines: lab })).toEqual([]);
    await t.db.insert(schema.orderingReferring).values([{ npi: "1234567893", lastName: "SMITH", firstName: "JANE", partB: true, dme: false }]);
    expect(await orderingFindings(t.db, { ...base, referringNpi: "1234567893", lines: lab })).toEqual([]);
    expect(rulesOf(await orderingFindings(t.db, { ...base, referringNpi: "1234567893", lines: [{ lineNumber: 2, cpt: "E0601" }] }))).toEqual(["ORDERING_NOT_ELIGIBLE:error"]);
    expect(rulesOf(await orderingFindings(t.db, { ...base, referringNpi: "1111111112", lines: lab }))).toEqual(["ORDERING_NOT_ENROLLED:error"]);
    expect(await orderingFindings(t.db, { ...base, payerType: "commercial", referringNpi: "1111111112", lines: lab })).toEqual([]);
    const [{ n }] = (await t.db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ordering_referring`)).rows;
    expect(Number(n)).toBe(1);
  });
});
