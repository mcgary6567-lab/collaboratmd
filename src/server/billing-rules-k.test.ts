import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { build271, parse271, summarize271, type Benefit } from "@/lib/edi/x270";
import { evaluatePayerEdits } from "@/lib/scrub/payer-edits";
import { scrubClaim, type ScrubClaim } from "@/lib/scrub/rules";
import { validateStructure } from "@/lib/edi/x999";
import { medicarePercentFor } from "@/lib/codes/credentials";
import { importRvus, parseRvuFile } from "./mpfs";
import { createEncounterWithClaim } from "./encounters";
import { globalPeriodFindings, globalPeriodIssues } from "./global-periods";
import { medicareAdvantageFinding } from "./patients";
import { loadClaimBundle, writeOffClaim } from "./claims";
import { buildClaimEdi } from "./claim-edi";
import { billCareMonth, careMonths, logCareMinutes, recordCareConsent, unitsFor } from "./care-programs";
import { createPayerEdit, serviceHistory } from "./payer-edits";
import { assertNoOpenRequest, createRecordsRequest, markRecordsSent, recordsRequestAlerts } from "./records-requests";
import { levelShift, productivity, sampleVisits } from "./productivity";
import { interestByPayer, interestLetter, latePayments, markInterestRequested, promptPayInterest, savePromptPayRule } from "./prompt-pay";

/** Shaped like CMS's PPRRVU file, with the global days column; synthetic filler so it reads as a full file. */
const RVU = [
  "2026 National Physician Fee Schedule Relative Value File",
  '"HCPCS","MOD","DESCRIPTION","STATUS","WORK","NON-FAC PE","FACILITY PE","MP","MULT","GLOB","CONV"',
  '"","","","CODE","RVU","RVU","RVU","RVU","PROC","DAYS","FACTOR"',
  '"99213","","Office visit est","A","1.30","1.21","0.53","0.10","0","XXX","33.4009"',
  '"99214","","Office visit est","A","1.92","1.59","0.78","0.13","0","XXX","33.4009"',
  '"27447","","Total knee arthroplasty","A","19.60","0.00","10.10","3.50","2","090","33.4009"',
  '"11042","","Debridement","A","1.01","2.46","0.60","0.14","2","000","33.4009"',
  ...Array.from({ length: 60 }, (_, i) => `"9${String(1000 + i)}","","Filler","A","1.00","1.00","0.50","0.10","0","XXX","33.4009"`),
].join("\n");

const scrub = (over: Partial<ScrubClaim> = {}): ScrubClaim => ({
  patient: { firstName: "Maria", lastName: "Garcia", dob: "1950-04-12", sex: "F", address1: "1 Main St", zip: "32801" },
  insurance: { memberId: "ABC123", payerId: "00590", relationship: "self" },
  provider: { npi: "1234567893", taxonomy: "207Q00000X" },
  practice: { npi: "1234567893", taxId: "12-3456789" },
  encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9"] },
  lines: [{ lineNumber: 1, cpt: "99213", modifiers: [], units: 1, chargeCents: 12000, dxPointers: [1] }],
  payer: { timelyFilingDays: 365, type: "commercial" },
  today: new Date("2026-09-21T00:00:00Z"),
  ...over,
});

describe("pure rules", () => {
  it("finds visits and procedures inside a global period", () => {
    const surgery = [{ code: "27447", dateOfService: "2026-08-01", globalDays: 90 }];
    const em = (mods: string[]) => [{ lineNumber: 1, cpt: "99213", modifiers: mods }];
    expect(globalPeriodIssues("2026-09-01", em([]), surgery, "medicare").map((f) => `${f.rule}:${f.severity}`)).toEqual(["GLOBAL_PERIOD:error"]);
    expect(globalPeriodIssues("2026-09-01", em([]), surgery, "commercial")[0].severity).toBe("warning");
    expect(globalPeriodIssues("2026-09-01", em(["24"]), surgery, "medicare")).toEqual([]);
    expect(globalPeriodIssues("2026-09-01", [{ lineNumber: 1, cpt: "99024", modifiers: [] }], surgery, "medicare")).toEqual([]);
    expect(globalPeriodIssues("2026-11-15", em([]), surgery, "medicare")).toEqual([]); // after day 90
    expect(globalPeriodIssues("2026-09-01", [{ lineNumber: 1, cpt: "20610", modifiers: [] }], surgery, "medicare")[0].message).toMatch(/58.*78.*79/);
    expect(globalPeriodIssues("2026-09-01", [{ lineNumber: 1, cpt: "20610", modifiers: ["79"] }], surgery, "medicare")).toEqual([]);
  });

  it("allows 99024 at $0.00 and checks the supervising provider", () => {
    const rules = (c: ScrubClaim) => scrubClaim(c).map((f) => f.rule);
    expect(rules(scrub({ lines: [{ lineNumber: 1, cpt: "99024", modifiers: [], units: 1, chargeCents: 0, dxPointers: [1] }] }))).not.toContain("LINE_CHARGE");
    expect(rules(scrub({ supervisor: { npi: "1234567893", name: "Dr. Same" } }))).toContain("SUPERVISING");
    expect(rules(scrub({ supervisor: { npi: "1234567890", name: "Dr. Bad" } }))).toContain("SUPERVISING");
    expect(rules(scrub({ supervisor: { npi: "9876543213", name: "Dr. Chen" } }))).not.toContain("SUPERVISING");
    expect([medicarePercentFor("NP"), medicarePercentFor("PA"), medicarePercentFor("CNS"), medicarePercentFor("CNM"), medicarePercentFor("MD"), medicarePercentFor(null)]).toEqual([85, 85, 85, 100, 100, 100]);
  });

  it("finds a Medicare Advantage plan in a 271, with its name from loop 2120", () => {
    const benefit = (over: Partial<Benefit>): Benefit => ({ code: "1", coverageLevel: "IND", serviceType: "30", insuranceType: "MB", planDescription: "", timePeriod: "", amountCents: null, percent: null, inNetwork: "", ...over });
    const inquiry = { traceNumber: "T1", payerId: "09102", payerName: "MEDICARE", providerNpi: "1234567893", providerName: "Clinic", memberId: "1EG4TE5MK73", lastName: "DOE", firstName: "JANE", dob: "1950-01-01", sex: "F", serviceDate: "2026-09-20", serviceTypes: ["30"] };
    const raw = build271({ senderId: "CMS", receiverId: "US", now: new Date("2026-09-20T12:00:00Z"), control: "1", inquiry, benefits: [benefit({}), benefit({ code: "R", insuranceType: "HN" })] })
      .replace(/(EB\*R\*[^~]*~)/, "$1LS*2120~NM1*PRP*2*SUNSHINE ADVANTAGE PLAN*****PI*H1234~LE*2120~");
    const r = parse271(raw);
    expect(r.payerName).toBe("MEDICARE"); // the 2120 NM1 does not replace the payer
    expect(r.relatedEntities).toEqual([{ entity: "PRP", name: "SUNSHINE ADVANTAGE PLAN", id: "H1234", benefitIndex: 1 }]);
    expect(summarize271(r).medicareAdvantage).toEqual({ plan: "SUNSHINE ADVANTAGE PLAN", payerId: "H1234" });
    expect(summarize271(parse271(build271({ senderId: "CMS", receiverId: "US", now: new Date(), control: "1", inquiry, benefits: [benefit({})] }))).medicareAdvantage).toBeUndefined();
  });

  it("counts earlier services against a frequency limit", () => {
    const rule = { id: "r1", kind: "frequency", cpt: "G0439", params: { maxCount: 1, periodDays: 365 }, severity: "error", message: "Annual wellness visit once a year" };
    const claim = (history: { cpt: string; dateOfService: string }[]) => ({ dateOfService: "2026-09-20", diagnoses: ["Z00.00"], lines: [{ lineNumber: 1, cpt: "G0439", modifiers: [], units: 1 }], history });
    expect(evaluatePayerEdits(claim([]), [rule], []).findings).toEqual([]);
    expect(evaluatePayerEdits(claim([{ cpt: "G0439", dateOfService: "2025-09-01" }]), [rule], []).findings).toEqual([]); // more than 365 days ago
    const f = evaluatePayerEdits(claim([{ cpt: "G0439", dateOfService: "2026-01-10" }]), [rule], []).findings;
    expect(f.map((x) => x.rule)).toEqual(["PAYER_FREQUENCY"]);
    expect(f[0].message).toMatch(/last on 2026-01-10/);
    const lifetime = { ...rule, params: { maxCount: 1, periodDays: 0 } };
    expect(evaluatePayerEdits(claim([{ cpt: "G0439", dateOfService: "2019-01-01" }]), [lifetime], []).findings).toHaveLength(1);
  });

  it("earns care program units by the month's minutes", () => {
    expect(unitsFor("ccm", 19)).toEqual([]);
    expect(unitsFor("ccm", 20)).toEqual([{ code: "99490", units: 1 }]);
    expect(unitsFor("ccm", 45)).toEqual([{ code: "99490", units: 1 }, { code: "99439", units: 1 }]);
    expect(unitsFor("ccm", 200)).toEqual([{ code: "99490", units: 1 }, { code: "99439", units: 2 }]); // capped
    expect(unitsFor("ccm_physician", 29)).toEqual([]);
    expect(unitsFor("bhi", 60)).toEqual([{ code: "99484", units: 1 }]);
  });

  it("works out interest and a coding profile shift", () => {
    expect(promptPayInterest(100_000, 30, 12)).toBe(986); // $1,000 x 12% x 30/365
    expect(promptPayInterest(100_000, 0, 12)).toBe(0);
    const practice = { total: 100, pct: [5, 10, 50, 30, 5] };
    expect(levelShift({ total: 40, pct: [0, 0, 20, 40, 40] }, practice)).toBeGreaterThan(0.5);
    expect(levelShift({ total: 5, pct: [0, 0, 0, 0, 100] }, practice)).toBeNull();
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let patientId: string;
  let providerId: string;
  let otherProviderId: string;
  beforeAll(async () => {
    t = await testDb();
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId)).limit(1);
    patientId = p.id;
    const provs = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(2);
    [providerId, otherProviderId] = [provs[0].id, provs[1].id];
  });
  afterAll(async () => { await t?.close(); });

  it("reads global days from the RVU file and finds a visit inside a surgery's global period", async () => {
    expect(parseRvuFile(RVU).rows.find((r) => r.code === "27447")?.globalDays).toBe("090");
    await importRvus(t.db, RVU, 2026, "PPRRVU26", "test");
    const [np] = await t.db.insert(schema.patients).values({ practiceId: t.practiceId, mrn: "GLOB-1", firstName: "Knee", lastName: "Patient", dob: "1955-02-02", sex: "M" }).returning();
    const [medicare] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "medicare"))).limit(1);
    await t.db.insert(schema.patientInsurances).values({ patientId: np.id, payerId: medicare.id, memberId: "1EG4TE5MK73", relationship: "self" });
    await createEncounterWithClaim(t.db, t.practiceId, { patientId: np.id, providerId, dateOfService: "2026-08-03", placeOfService: "21", diagnoses: ["M17.11"], lines: [{ cpt: "27447", modifiers: ["RT"], units: 1, chargeCents: 250_000, dxPointers: [1] }] });
    const { encounter } = await createEncounterWithClaim(t.db, t.practiceId, { patientId: np.id, providerId, dateOfService: "2026-09-10", placeOfService: "11", diagnoses: ["M17.11"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 12_000, dxPointers: [1] }] });
    const f = await globalPeriodFindings(t.db, { practiceId: t.practiceId, patientId: np.id, encounterId: encounter.id, dateOfService: "2026-09-10", payerType: "medicare", lines: [{ lineNumber: 1, cpt: "99213", modifiers: [] }] });
    expect(f.map((x) => x.rule)).toEqual(["GLOBAL_PERIOD"]);
    expect(f[0].message).toMatch(/90-day global period of 27447 on 2026-08-03/);
    // A routine post-op visit goes in at $0.00.
    await expect(createEncounterWithClaim(t.db, t.practiceId, { patientId: np.id, providerId, dateOfService: "2026-09-12", placeOfService: "11", diagnoses: ["M17.11"], lines: [{ cpt: "99024", modifiers: [], units: 1, chargeCents: 0, dxPointers: [1] }] })).resolves.toBeTruthy();
  });

  it("measures work RVUs and samples visits for review", async () => {
    const r = await productivity(t.db, t.practiceId, "2026-08-01", "2026-09-30");
    expect(r.rvusLoaded).toBe(true);
    const p = r.providers.find((x) => x.id === providerId)!;
    expect(p.wrvu).toBeGreaterThanOrEqual(19.6 + 1.3);
    const sample = await sampleVisits(t.db, t.practiceId, providerId, "2026-08-01", "2026-09-30", 3);
    expect(sample.length).toBeGreaterThan(0);
    expect(sample.length).toBeLessThanOrEqual(3);
  });

  it("stops a Medicare claim for a patient Medicare says is in a Medicare Advantage plan", async () => {
    const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.patientId, patientId)).limit(1);
    const base = { patientInsuranceId: ins.id, payerType: "medicare", dateOfService: "2026-09-20" };
    expect(await medicareAdvantageFinding(t.db, base)).toBeNull();
    await t.db.insert(schema.eligibilityChecks).values({ patientInsuranceId: ins.id, status: "active", serviceDate: "2026-09-18", response: { transaction: "271", status: "active", medicareAdvantage: { plan: "SUNSHINE ADVANTAGE PLAN", payerId: "H1234" } } });
    expect((await medicareAdvantageFinding(t.db, base))?.message).toMatch(/SUNSHINE ADVANTAGE PLAN, ID H1234/);
    expect(await medicareAdvantageFinding(t.db, { ...base, payerType: "commercial" })).toBeNull();
    expect(await medicareAdvantageFinding(t.db, { ...base, dateOfService: "2027-06-01" })).toBeNull(); // checked too long before
  });

  it("sends the supervising provider on the 837P", async () => {
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, supervisingProviderId: otherProviderId, dateOfService: "2026-09-15", placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 12_000, dxPointers: [1] }] });
    const b = (await loadClaimBundle(t.db, claim.id))!;
    expect(b.supervisor?.id).toBe(otherProviderId);
    const edi = buildClaimEdi(b, { now: new Date("2026-09-25T10:00:00Z"), authorizationNumber: null, attachments: [] });
    expect(edi).toContain(`NM1*DQ*1*${b.supervisor!.lastName}*${b.supervisor!.firstName}****XX*${b.supervisor!.npi}~`);
    expect(validateStructure(edi)).toEqual([]);
    await expect(createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, supervisingProviderId: providerId, dateOfService: "2026-09-15", placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "99213", modifiers: [], units: 1, chargeCents: 12_000, dxPointers: [1] }] })).rejects.toThrow(/supervising/);
  });

  it("logs care program minutes and bills a finished month once", async () => {
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10)).toISOString().slice(0, 10);
    const month = lastMonth.slice(0, 7);
    for (const code of ["99490", "99439", "99491"]) await t.db.insert(schema.cptCodes).values({ code, description: "Care management", defaultFeeCents: 6_000 }).onConflictDoNothing();
    await logCareMinutes(t.db, t.practiceId, { patientId, providerId, program: "ccm", performedOn: lastMonth, minutes: 25 }, t.userId);
    await logCareMinutes(t.db, t.practiceId, { patientId, providerId, program: "ccm", performedOn: lastMonth, minutes: 20 }, t.userId);
    await expect(logCareMinutes(t.db, t.practiceId, { patientId, providerId, program: "ccm", performedOn: "2999-01-01", minutes: 10 })).rejects.toThrow(/future/);
    const m = (await careMonths(t.db, t.practiceId, patientId)).months.find((x) => x.program === "ccm" && x.month === month)!;
    expect(m).toMatchObject({ minutes: 45, ended: true, lines: [{ code: "99490", units: 1 }, { code: "99439", units: 1 }] });

    await expect(billCareMonth(t.db, t.practiceId, { patientId, program: "ccm", month, diagnoses: ["E11.9", "I10"] })).rejects.toThrow(/consent/);
    await recordCareConsent(t.db, t.practiceId, patientId, "ccm", lastMonth.slice(0, 8) + "01", t.userId);
    await expect(billCareMonth(t.db, t.practiceId, { patientId, program: "ccm", month, diagnoses: ["E11.9"] })).rejects.toThrow(/two or more/);
    await expect(billCareMonth(t.db, t.practiceId, { patientId, program: "ccm", month: now.toISOString().slice(0, 7), diagnoses: ["E11.9", "I10"] })).rejects.toThrow(/not ended/);
    const r = await billCareMonth(t.db, t.practiceId, { patientId, program: "ccm", month, diagnoses: ["E11.9", "I10"] }, t.userId);
    const lines = await t.db.select().from(schema.charges).innerJoin(schema.claims, eq(schema.claims.encounterId, schema.charges.encounterId)).where(eq(schema.claims.id, r.claim.id));
    expect(lines.map((l) => `${l.charges.cpt}x${l.charges.units}`).sort()).toEqual(["99439x1", "99490x1"]);
    await expect(billCareMonth(t.db, t.practiceId, { patientId, program: "ccm", month, diagnoses: ["E11.9", "I10"] })).rejects.toThrow(/already billed/);
    await expect(logCareMinutes(t.db, t.practiceId, { patientId, providerId, program: "ccm", performedOn: lastMonth, minutes: 5 })).rejects.toThrow(/already billed/);
    // Physician CCM for the same month is refused once staff CCM is billed.
    await recordCareConsent(t.db, t.practiceId, patientId, "ccm_physician", lastMonth.slice(0, 8) + "01");
    await logCareMinutes(t.db, t.practiceId, { patientId, providerId, program: "ccm_physician", performedOn: lastMonth, minutes: 35 });
    await expect(billCareMonth(t.db, t.practiceId, { patientId, program: "ccm_physician", month, diagnoses: ["E11.9", "I10"] })).rejects.toThrow(/only one/);
  });

  it("keeps frequency limits as payer edits and finds the patient's history", async () => {
    await expect(createPayerEdit(t.db, t.practiceId, { payerId: null, kind: "frequency", cpt: "G0439", maxCount: 0, periodDays: 365, severity: "error" })).rejects.toThrow(/how many times/);
    const edit = await createPayerEdit(t.db, t.practiceId, { payerId: null, kind: "frequency", cpt: "99213", maxCount: 1, periodDays: 30, severity: "warning" });
    expect(edit.params).toEqual({ maxCount: 1, periodDays: 30 });
    const history = await serviceHistory(t.db, t.practiceId, patientId, "00000000-0000-0000-0000-000000000000", ["99213"]);
    expect(history.some((h) => h.dateOfService === "2026-09-15")).toBe(true);
  });

  it("tracks a records request and holds the claim until the records are sent", async () => {
    const [claim] = await t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.status, "denied"))).limit(1);
    const r = await createRecordsRequest(t.db, t.practiceId, { kind: "adr", claimControlNumber: claim.controlNumber, receivedOn: "2026-09-20" }, t.userId);
    expect(r).toMatchObject({ dueOn: "2026-11-04", claimId: claim.id, status: "open" }); // 45 days
    await expect(createRecordsRequest(t.db, t.practiceId, { kind: "adr", claimControlNumber: "NOPE", receivedOn: "2026-09-20" })).rejects.toThrow(/No claim/);
    await expect(writeOffClaim(t.db, claim.id, "Small balance", t.userId)).rejects.toThrow(/medical records/);
    await expect(assertNoOpenRequest(t.db, claim.id, "send an appeal")).rejects.toThrow(/due 2026-11-04/);
    expect((await recordsRequestAlerts(t.db, t.practiceId, new Date("2026-11-01T12:00:00Z"))).dueSoon).toBeGreaterThanOrEqual(1);
    await expect(markRecordsSent(t.db, t.practiceId, r.id, { sentOn: "2026-09-25", sentVia: "" })).rejects.toThrow(/how they were sent/);
    await markRecordsSent(t.db, t.practiceId, r.id, { sentOn: "2026-09-25", sentVia: "esMD" }, t.userId);
    await expect(assertNoOpenRequest(t.db, claim.id, "send an appeal")).resolves.toBeUndefined();
  });

  it("finds late commercial payments under the practice's prompt-pay rule and asks once", async () => {
    const [practice] = await t.db.select().from(schema.practices).where(eq(schema.practices.id, t.practiceId));
    expect(await latePayments(t.db, t.practiceId)).toEqual([]); // no rule yet
    await expect(savePromptPayRule(t.db, t.practiceId, { state: "ZZ", days: 30, annualRatePct: 12 })).rejects.toThrow(/state/);
    await savePromptPayRule(t.db, t.practiceId, { state: practice.state, days: 30, annualRatePct: 12, citation: "Test statute 1.1" }, t.userId);
    const [commercial] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
    const { claim } = await createEncounterWithClaim(t.db, t.practiceId, { patientId, providerId, dateOfService: "2026-07-01", placeOfService: "11", diagnoses: ["E11.9"], lines: [{ cpt: "99214", modifiers: [], units: 1, chargeCents: 20_000, dxPointers: [1] }] });
    const submitted = new Date(Date.now() - 80 * 86_400_000);
    await t.db.update(schema.claims).set({ payerId: commercial.id, submittedAt: submitted, status: "paid" }).where(eq(schema.claims.id, claim.id));
    await t.db.insert(schema.ledgerEntries).values({ practiceId: t.practiceId, patientId, claimId: claim.id, type: "insurance_payment", amountCents: 10_000, note: "late payment" });
    const late = (await latePayments(t.db, t.practiceId)).find((l) => l.claimId === claim.id)!;
    expect(late).toMatchObject({ daysToPay: 80, daysLate: 50, interestCents: promptPayInterest(10_000, 50, 12) });
    const letter = await interestLetter(t.db, t.practiceId, commercial.id);
    expect(letter.text).toContain(claim.controlNumber);
    expect(letter.text).toContain("Test statute 1.1");
    const before = (await interestByPayer(t.db, t.practiceId)).find((g) => g.payerId === commercial.id)!;
    expect(before.count).toBeGreaterThanOrEqual(1);
    await markInterestRequested(t.db, t.practiceId, commercial.id, t.userId);
    expect((await interestByPayer(t.db, t.practiceId)).some((g) => g.payerId === commercial.id)).toBe(false);
    expect((await interestLetter(t.db, t.practiceId, commercial.id)).claims).toEqual([]);
  });
});
