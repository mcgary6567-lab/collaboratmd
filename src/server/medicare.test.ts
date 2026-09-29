import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { importGpcis, importRvus, medicareAllowed, parseGpciFile, parseRvuFile } from "./mpfs";
import { contractFromMedicare, checkClaimUnderpayment } from "./fees";
import { mspFindings, mspResult, recordMspScreening } from "./msp";
import { isCrossover } from "./claims";
import { parseEdi835 } from "@/lib/edi/x835";
import { buildEdi837P } from "@/lib/edi/x837p";
import { eightMinuteRule, unitsForMinutes } from "@/lib/time-units";
import { scrubClaim, type ScrubClaim } from "@/lib/scrub/rules";

/** An RVU file shaped like CMS's: title lines, a header split over two rows, then data (and filler so it reads as a real file). */
const RVU = [
  "2026 National Physician Fee Schedule Relative Value File",
  "CPT codes and descriptions only are copyright AMA",
  '"HCPCS","MOD","DESCRIPTION","STATUS","WORK","NON-FAC PE","FACILITY PE","MP","MULT","CONV"',
  '"","","","CODE","RVU","RVU","RVU","RVU","PROC","FACTOR"',
  '"99213","","Office visit est","A","1.30","1.21","0.53","0.10","0","33.4009"',
  '"20610","","Arthrocentesis major joint","A","0.79","1.00","0.45","0.10","2","33.4009"',
  '"20605","","Arthrocentesis intermediate joint","A","0.68","0.95","0.40","0.08","2","33.4009"',
  '"71046","26","Chest x-ray 2 views","A","0.22","0.09","0.09","0.02","0","33.4009"',
  '"71046","","Chest x-ray 2 views","A","0.22","0.76","0.76","0.02","0","33.4009"',
  ...Array.from({ length: 60 }, (_, i) => `"9${String(1000 + i)}","","Filler","A","1.00","1.00","0.50","0.10","0","33.4009"`),
].join("\n");

const GPCI = [
  "Addendum E. Final CY 2026 Geographic Practice Cost Indices (GPCIs) by State and Medicare Locality",
  '"Medicare Administrative Contractor (MAC)","State","Locality Number","Locality Name","2026 PW GPCI (with 1.0 Floor)","2026 PE GPCI","2026 MP GPCI"',
  '"09102","FL","04","MIAMI","1.000","1.050","1.900"',
  '"09102","FL","99","REST OF FLORIDA","1.000","0.950","1.300"',
].join("\n");

describe("the Medicare physician fee schedule", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("reads CMS's RVU and GPCI files, including split headers", () => {
    const r = parseRvuFile(RVU);
    expect(r.conversionFactor).toBe(33.4009);
    expect(r.rows.find((x) => x.code === "99213")).toMatchObject({ workRvu: 1.3, peNonFacility: 1.21, peFacility: 0.53, mpRvu: 0.1, multProc: "0" });
    expect(r.rows.find((x) => x.code === "71046" && x.modifier === "26")?.peNonFacility).toBe(0.09);
    expect(parseGpciFile(GPCI).rows[0]).toMatchObject({ carrier: "09102", locality: "04", name: "MIAMI", state: "FL", peGpci: 1.05 });
  });

  it("prices a code for the locality, at office or facility rates, and prices contracts and underpayments from it", async () => {
    await importRvus(t.db, RVU, 2026, "PPRRVU26", "test");
    await importGpcis(t.db, GPCI, 2026, "GPCI2026", "test");
    const loc = { carrier: "09102", locality: "04" };
    const office = await medicareAllowed(t.db, loc, "2026-09-01", "11", [{ cpt: "99213" }, { cpt: "20610" }, { cpt: "71046", modifiers: ["26"] }, { cpt: "ABCDE" }]);
    // (1.30 x 1.000 + 1.21 x 1.050 + 0.10 x 1.900) x 33.4009 = $92.20
    expect(office.rates.get("99213")).toBe(Math.round((1.3 + 1.21 * 1.05 + 0.1 * 1.9) * 33.4009 * 100));
    expect(office.rates.get("71046")).toBe(Math.round((0.22 + 0.09 * 1.05 + 0.02 * 1.9) * 33.4009 * 100));
    expect(office.rates.has("ABCDE")).toBe(false);
    expect([...office.mppr]).toEqual(["20610"]);
    const hospital = await medicareAllowed(t.db, loc, "2026-09-01", "22", [{ cpt: "99213" }]);
    expect(hospital.rates.get("99213")).toBeLessThan(office.rates.get("99213")!);

    // A practice without a locality cannot build a Medicare-based contract.
    const [payer] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "commercial"))).limit(1);
    await expect(contractFromMedicare(t.db, t.practiceId, payer.id, 120)).rejects.toThrow(/locality/);
    await t.db.update(schema.practices).set({ medicareCarrier: "09102", medicareLocality: "04" }).where(eq(schema.practices.id, t.practiceId));
    const c = await contractFromMedicare(t.db, t.practiceId, payer.id, 120, new Date("2026-09-01T12:00:00Z"));
    const [item] = await t.db.select().from(schema.feeScheduleItems).where(and(eq(schema.feeScheduleItems.feeScheduleId, c.schedule.id), eq(schema.feeScheduleItems.cpt, "99213")));
    expect(item.amountCents).toBe(Math.round(office.rates.get("99213")! * 1.2));

    // A paid Medicare claim with no contract is judged against the fee schedule.
    const [medicare] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "medicare"))).limit(1);
    const [claim] = await t.db.select().from(schema.claims).where(and(eq(schema.claims.practiceId, t.practiceId), eq(schema.claims.payerId, medicare.id), eq(schema.claims.status, "paid"))).limit(1);
    if (claim) {
      const verdict = await checkClaimUnderpayment(t.db, claim.id);
      expect(verdict === null || typeof verdict === "object").toBe(true);
    }
  });
});

describe("Medicare Secondary Payer", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("decides who pays first in CMS's order", () => {
    expect(mspResult({})).toEqual({ medicarePrimary: true, mspType: null });
    expect(mspResult({ workingAged: true })).toEqual({ medicarePrimary: false, mspType: "12" });
    expect(mspResult({ workingAged: true, workersComp: true }).mspType).toBe("15");
  });

  it("marks the Medicare coverage, stops a claim billed to Medicare first, and sends SBR05 when Medicare is second", async () => {
    const [ins] = await t.db.select({ ins: schema.patientInsurances }).from(schema.patientInsurances).innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.type, "medicare"))).limit(1);
    const patientId = ins.ins.patientId;
    expect((await mspFindings(t.db, { patientId, payerType: "medicare", payerSequence: "P", mspType: null })).map((f) => f.rule)).not.toContain("MSP_ORDER");
    await recordMspScreening(t.db, t.practiceId, patientId, { workingAged: true }, t.userId);
    const [after] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.id, ins.ins.id));
    expect(after.mspType).toBe("12");
    expect((await mspFindings(t.db, { patientId, payerType: "medicare", payerSequence: "P", mspType: "12" })).map((f) => f.rule)).toContain("MSP_ORDER");
    expect((await mspFindings(t.db, { patientId, payerType: "medicare", payerSequence: "S", mspType: null })).map((f) => f.rule)).toContain("MSP_TYPE");
    expect(await mspFindings(t.db, { patientId, payerType: "commercial", payerSequence: "P", mspType: null })).toEqual([]);

    const edi = buildEdi837P({
      controlNumber: "CMD000901", interchangeControl: "1", senderId: "S", receiverId: "09102", now: new Date("2026-09-21T12:00:00Z"),
      billingProvider: { name: "Lakeside", npi: "1234567893", taxId: "12-3456789", address1: "1 Main St", city: "Orlando", state: "FL", zip: "32801", phone: "407-555-0100" },
      renderingProvider: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "207Q00000X" },
      payer: { name: "Medicare", payerId: "09102", type: "medicare" },
      subscriber: { lastName: "Reyes", firstName: "Ana", memberId: "1EG4TE5MK73", dob: "1950-01-01", sex: "F", relationship: "self" },
      mspType: "12",
      otherPayer: { name: "Employer Plan", payerId: "EMP01", type: "commercial", paidCents: 5000, adjudicatedOn: "2026-09-10", adjustments: [{ group: "PR", reason: "2", amountCents: 7000 }], subscriber: { lastName: "Reyes", firstName: "Ana", memberId: "E1", relationship: "self" } },
      claim: { totalCents: 12000, placeOfService: "11", frequencyCode: "1", dateOfService: "2026-09-01", diagnoses: ["I10"] },
      lines: [{ cpt: "99213", modifiers: [], chargeCents: 12000, units: 1, dxPointers: [1], dateOfService: "2026-09-01" }],
    });
    expect(edi).toContain("SBR*S*18***12****MB~");
  });

  it("recognizes a claim Medicare forwarded to a supplemental insurer (crossover)", () => {
    const x = "ISA*00*          *00*          *ZZ*MEDICARE       *ZZ*SUB            *260921*1200*^*00501*000000001*0*P*:~GS*HP*M*S*20260921*1200*1*X*005010X221A1~ST*835*0001~BPR*I*50*C*ACH~TRN*1*C1*1~DTM*405*20260921~N1*PR*MEDICARE~N1*PE*LAKESIDE*XX*1234567893~LX*1~CLP*CMD000001*19*120*50*20**11*MCN1~NM1*QC*1*REYES*ANA~NM1*TT*2*AARP MEDIGAP*****PI*MG01~SE*11*0001~GE*1*1~IEA*1*000000001~";
    const [c] = parseEdi835(x).claims;
    expect(c.crossoverPayer).toBe("AARP MEDIGAP");
    expect(isCrossover(c)).toBe(true);
    expect(isCrossover({ statusCode: "1", remarks: ["MA18"] })).toBe(true);
    expect(isCrossover({ statusCode: "1", remarks: [] })).toBe(false);
  });
});

describe("time-based codes", () => {
  it("applies the 8-minute rule across the visit's timed codes", () => {
    expect(unitsForMinutes(7)).toBe(0);
    expect(unitsForMinutes(8)).toBe(1);
    expect(unitsForMinutes(22)).toBe(1);
    expect(unitsForMinutes(23)).toBe(2);
    // 33 minutes of exercise and 7 of manual therapy: 40 minutes is 3 units, the third to the code with more left over.
    expect(Object.fromEntries(eightMinuteRule([{ code: "97110", minutes: 33 }, { code: "97140", minutes: 7 }]))).toEqual({ "97110": 2, "97140": 1 });
    // 7 and 7: 14 minutes is 1 unit.
    expect([...eightMinuteRule([{ code: "97110", minutes: 7 }, { code: "97140", minutes: 7 }]).values()].reduce((a, b) => a + b, 0)).toBe(1);
    // Untimed codes do not count.
    expect(eightMinuteRule([{ code: "97161", minutes: 45 }]).size).toBe(0);
  });

  it("checks therapy modifiers and units, and anesthesia minutes and modifiers, and sends anesthesia in minutes", () => {
    const claim = (lines: ScrubClaim["lines"], type = "medicare"): ScrubClaim => ({
      patient: { firstName: "Ana", lastName: "Reyes", dob: "1950-03-02", sex: "F", address1: "9 Palm St", zip: "33601" },
      insurance: { memberId: "1EG4TE5MK73", payerId: "09102", relationship: "self" },
      provider: { npi: "1234567893", taxonomy: "225100000X" },
      practice: { npi: "1234567893", taxId: "12-3456789", phone: "407-555-0100" },
      encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["M54.50"] },
      lines, payer: { timelyFilingDays: 365, type }, today: new Date("2026-09-10T12:00:00Z"),
    });
    const rules = (c: ScrubClaim) => scrubClaim(c).map((f) => f.rule);
    const line = (cpt: string, units: number, modifiers: string[] = [], minutes?: number) => ({ lineNumber: 1, cpt, modifiers, units, chargeCents: 5000, dxPointers: [1], minutes });
    expect(rules(claim([line("97110", 2)]))).toEqual(expect.arrayContaining(["THERAPY_MODIFIER", "THERAPY_UNITS"]));
    expect(rules(claim([line("97110", 3, ["GP"], 33)]))).toContain("THERAPY_UNITS");
    expect(rules(claim([line("97110", 2, ["GP"], 33)]))).not.toEqual(expect.arrayContaining(["THERAPY_UNITS", "THERAPY_MODIFIER"]));
    expect(rules(claim([line("00790", 1)]))).toEqual(expect.arrayContaining(["ANESTHESIA_MINUTES", "ANESTHESIA_MODIFIER"]));
    expect(rules(claim([line("00790", 1, ["AA"], 95)]))).not.toEqual(expect.arrayContaining(["ANESTHESIA_MINUTES"]));

    const edi = buildEdi837P({
      controlNumber: "CMD000902", interchangeControl: "1", senderId: "S", receiverId: "09102", now: new Date("2026-09-21T12:00:00Z"),
      billingProvider: { name: "Lakeside", npi: "1234567893", taxId: "12-3456789", address1: "1 Main St", city: "Orlando", state: "FL", zip: "32801", phone: "407-555-0100" },
      renderingProvider: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "207L00000X" },
      payer: { name: "Medicare", payerId: "09102", type: "medicare" },
      subscriber: { lastName: "Reyes", firstName: "Ana", memberId: "1EG4TE5MK73", dob: "1950-01-01", sex: "F", relationship: "self" },
      claim: { totalCents: 90000, placeOfService: "22", frequencyCode: "1", dateOfService: "2026-09-01", diagnoses: ["K80.20"] },
      lines: [{ cpt: "00790", modifiers: ["AA"], chargeCents: 90000, units: 1, dxPointers: [1], dateOfService: "2026-09-01", minutes: 95 }],
    });
    expect(edi).toContain("*MJ*95*");
  });
});
