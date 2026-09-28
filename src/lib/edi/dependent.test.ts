import { describe, expect, it } from "vitest";
import { buildEdi837P } from "./x837p";
import { buildEdi837I } from "./x837i";
import { buildEdi837D } from "./x837d";
import { build270 } from "./x270";
import { validateX12 } from "./validate";
import { isValidMbi, scrubClaim, type ScrubClaim } from "../scrub/rules";

const segments = (edi: string) => edi.split("~").map((s) => s.trim()).filter(Boolean);

// A child on her mother's plan: the claim is for Sofia, the insured person is Ana.
const ana = { lastName: "Reyes", firstName: "Ana", memberId: "XYZ123", groupNumber: "G9", dob: "1984-03-02", sex: "F", address1: "9 Palm St", city: "Tampa", state: "FL", zip: "33601", relationship: "child" };
const sofia = { lastName: "Reyes", firstName: "Sofia", dob: "2016-07-19", sex: "F", address1: "9 Palm St", city: "Tampa", state: "FL", zip: "33601" };
const base = {
  controlNumber: "CMD000077", interchangeControl: "1", senderId: "COLLABORATMD", receiverId: "00590", now: new Date("2026-09-21T14:30:00Z"),
  billingProvider: { name: "Lakeside Family Medicine", phone: "407-555-0100", npi: "1234567893", taxId: "12-3456789", address1: "410 Lakeside Ave", city: "Orlando", state: "FL", zip: "32801" },
};

describe("a dependent's claim names the insured person as the subscriber and the patient in loop 2000C", () => {
  it("837P", () => {
    const edi = buildEdi837P({
      ...base,
      renderingProvider: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "207Q00000X" },
      payer: { name: "BCBS FL", payerId: "00590", type: "commercial" },
      subscriber: ana, patient: sofia,
      claim: { totalCents: 12000, placeOfService: "11", frequencyCode: "1", dateOfService: "2026-09-01", diagnoses: ["J06.9"] },
      lines: [{ cpt: "99213", modifiers: [], chargeCents: 12000, units: 1, dxPointers: [1], dateOfService: "2026-09-01" }],
    });
    const s = segments(edi);
    expect(s).toContain("HL*2*1*22*1");
    // SBR02 is only ever 18 (self); for a dependent it is empty.
    expect(s).toContain("SBR*P**G9******CI");
    expect(s).toContain("NM1*IL*1*Reyes*Ana****MI*XYZ123");
    expect(s).toContain("DMG*D8*19840302*F");
    const payer = s.indexOf("NM1*PR*2*BCBS FL*****PI*00590");
    expect(s.slice(payer + 1, payer + 5)).toEqual(["HL*3*2*23*0", "PAT*19", "NM1*QC*1*Reyes*Sofia", "N3*9 Palm St"]);
    expect(s).toContain("DMG*D8*20160719*F");
    expect(s.indexOf("PAT*19")).toBeLessThan(s.findIndex((x) => x.startsWith("CLM*")));
    expect(validateX12(edi).errors).toEqual([]);
  });

  it("837I and 837D", () => {
    const inst = buildEdi837I({
      ...base,
      attending: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "207Q00000X" },
      payer: { name: "BCBS FL", payerId: "00590", type: "commercial" },
      subscriber: ana, patient: sofia,
      claim: { totalCents: 50000, frequencyCode: "1", diagnoses: ["J06.9"], institutional: { typeOfBill: "0131", statementFrom: "2026-09-01", statementTo: "2026-09-01", patientStatus: "01" } as never },
      lines: [{ revenueCode: "0450", hcpcs: "99283", modifiers: [], chargeCents: 50000, units: 1, dateOfService: "2026-09-01" }],
    });
    expect(segments(inst)).toContain("PAT*19");
    expect(validateX12(inst).errors).toEqual([]);
    const dental = buildEdi837D({
      ...base,
      billingProvider: { ...base.billingProvider, taxonomy: "1223G0001X" },
      rendering: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "1223G0001X" },
      payer: { name: "Delta Dental", payerId: "94276", type: "commercial" },
      subscriber: { ...ana, relationship: "spouse" }, patient: sofia,
      claim: { totalCents: 21000, placeOfService: "11", frequencyCode: "1", diagnoses: [] },
      lines: [{ cdt: "D2392", chargeCents: 21000, units: 1, dateOfService: "2026-09-01", tooth: "30", surfaces: "MO", oralCavity: null }],
    });
    expect(segments(dental)).toContain("PAT*01");
    expect(validateX12(dental).errors).toEqual([]);
  });

  it("the patient's own plan keeps a single subscriber level with SBR02 = 18", () => {
    const edi = buildEdi837P({
      ...base,
      renderingProvider: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "207Q00000X" },
      payer: { name: "Medicare Part B", payerId: "09102", type: "medicare" },
      subscriber: { ...ana, relationship: "self" },
      claim: { totalCents: 12000, placeOfService: "11", frequencyCode: "1", dateOfService: "2026-09-01", diagnoses: ["J06.9"] },
      lines: [{ cpt: "99213", modifiers: [], chargeCents: 12000, units: 1, dxPointers: [1], dateOfService: "2026-09-01" }],
    });
    const s = segments(edi);
    expect(s).toContain("HL*2*1*22*0");
    // Medicare Part B: filing indicator MB, not CI.
    expect(s).toContain("SBR*P*18*G9******MB");
    expect(s.some((x) => x.startsWith("PAT*"))).toBe(false);
  });

  it("asks about a dependent's coverage under the insured person, in loop 2000D", () => {
    const edi = build270({
      senderId: "S", receiverId: "R", now: new Date("2026-09-25T12:00:00Z"), control: "1", traceNumber: "T1",
      payer: { name: "BCBS FL", payerId: "00590" }, provider: { name: "Lakeside", npi: "1234567893" },
      subscriber: { lastName: "Reyes", firstName: "Ana", memberId: "XYZ123", dob: "1984-03-02", sex: "F" },
      dependent: { lastName: "Reyes", firstName: "Sofia", dob: "2016-07-19", sex: "F" },
      serviceDate: "2026-09-25",
    });
    const s = segments(edi);
    const at = s.indexOf("HL*4*3*23*0");
    expect(s).toContain("HL*3*2*22*1");
    expect(at).toBeGreaterThan(0);
    expect(s.slice(at + 1, at + 6).map((x) => x.split("*")[0])).toEqual(["TRN", "NM1", "DMG", "DTP", "EQ"]);
    expect(s).toContain("NM1*03*1*Reyes*Sofia");
  });
});

describe("claim checks for US payers", () => {
  const claim = (over: Partial<ScrubClaim>): ScrubClaim => ({
    patient: { firstName: "Sofia", lastName: "Reyes", dob: "2016-07-19", sex: "F", address1: "9 Palm St", zip: "33601" },
    insurance: { memberId: "XYZ123", payerId: "00590", relationship: "self" },
    provider: { npi: "1234567893", taxonomy: "207Q00000X" },
    practice: { npi: "1234567893", taxId: "12-3456789", phone: "407-555-0100" },
    encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["J06.9"] },
    lines: [{ lineNumber: 1, cpt: "99213", modifiers: [], units: 1, chargeCents: 12000, dxPointers: [1] }],
    payer: { timelyFilingDays: 90 },
    today: new Date("2026-09-10T12:00:00Z"),
    ...over,
  });
  const rules = (c: ScrubClaim) => scrubClaim(c).map((f) => f.rule);

  it("needs the insured person for a dependent", () => {
    expect(rules(claim({ insurance: { memberId: "X1", payerId: "00590", relationship: "child" } }))).toContain("SUBSCRIBER_DEPENDENT");
    expect(rules(claim({ insurance: { memberId: "X1", payerId: "00590", relationship: "child", subscriber: { firstName: "Ana", lastName: "Reyes", dob: "1984-03-02" } } }))).not.toContain("SUBSCRIBER_DEPENDENT");
  });

  it("checks a Medicare member ID is an MBI", () => {
    expect(isValidMbi("1EG4-TE5-MK73")).toBe(true);
    expect(isValidMbi("1EG4TE5MK73")).toBe(true);
    expect(isValidMbi("1SG4TE5MK73")).toBe(false); // S is never used
    expect(isValidMbi("123456789A")).toBe(false); // an old SSN-based HICN
    expect(rules(claim({ payer: { timelyFilingDays: 365, type: "medicare" }, insurance: { memberId: "123456789A", payerId: "09102", relationship: "self" } }))).toContain("MEDICARE_MBI");
    expect(rules(claim({ payer: { timelyFilingDays: 365, type: "medicare" }, insurance: { memberId: "1EG4TE5MK73", payerId: "09102", relationship: "self" } }))).not.toContain("MEDICARE_MBI");
    expect(rules(claim({ insurance: { memberId: "123456789A", payerId: "00590", relationship: "self" } }))).not.toContain("MEDICARE_MBI");
  });
});

describe("solo providers, lab tests and referrals on the professional claim", () => {
  it("bills as the provider (NM1*85*1), sends the CLIA number and the referring provider", () => {
    const edi = buildEdi837P({
      ...base,
      billingProvider: { ...base.billingProvider, individual: { lastName: "Chen", firstName: "Sarah" } },
      renderingProvider: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "207Q00000X" },
      referringProvider: { lastName: "Patel", firstName: "Raj", npi: "1245319599" },
      payer: { name: "Medicare Part B", payerId: "09102", type: "medicare" },
      subscriber: { ...ana, relationship: "self" },
      claim: { totalCents: 4000, placeOfService: "11", frequencyCode: "1", dateOfService: "2026-09-01", diagnoses: ["E11.9"], cliaNumber: "10D1234567" },
      lines: [{ cpt: "83036", modifiers: ["QW"], chargeCents: 4000, units: 1, dxPointers: [1], dateOfService: "2026-09-01" }],
    });
    const s = segments(edi);
    expect(s).toContain("NM1*85*1*Chen*Sarah****XX*1234567893");
    expect(s).toContain("REF*X4*10D1234567");
    const dn = s.indexOf("NM1*DN*1*Patel*Raj****XX*1245319599");
    expect(dn).toBeGreaterThan(s.findIndex((x) => x.startsWith("CLM*")));
    expect(dn).toBeLessThan(s.indexOf("NM1*82*1*Chen*Sarah****XX*1234567893"));
    expect(validateX12(edi).errors).toEqual([]);
  });
});

describe("lab, referral and ABN checks", () => {
  const claim = (over: Partial<ScrubClaim>): ScrubClaim => ({
    patient: { firstName: "Ana", lastName: "Reyes", dob: "1950-03-02", sex: "F", address1: "9 Palm St", zip: "33601" },
    insurance: { memberId: "1EG4TE5MK73", payerId: "09102", relationship: "self" },
    provider: { npi: "1234567893", taxonomy: "207Q00000X" },
    practice: { npi: "1234567893", taxId: "12-3456789", phone: "407-555-0100" },
    encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9"] },
    lines: [{ lineNumber: 1, cpt: "83036", modifiers: [], units: 1, chargeCents: 4000, dxPointers: [1] }],
    payer: { timelyFilingDays: 365, type: "medicare" },
    today: new Date("2026-09-10T12:00:00Z"),
    ...over,
  });
  const find = (c: ScrubClaim, rule: string) => scrubClaim(c).find((f) => f.rule === rule);

  it("needs a CLIA number for lab tests: an error for Medicare, a warning for others", () => {
    expect(find(claim({}), "CLIA")?.severity).toBe("error");
    expect(find(claim({ payer: { timelyFilingDays: 90, type: "commercial" } }), "CLIA")?.severity).toBe("warning");
    expect(find(claim({ practice: { npi: "1234567893", taxId: "12-3456789", cliaNumber: "10D12345" } }), "CLIA")?.severity).toBe("error");
    expect(find(claim({ practice: { npi: "1234567893", taxId: "12-3456789", cliaNumber: "10D1234567" } }), "CLIA")).toBeUndefined();
    expect(find(claim({ lines: [{ lineNumber: 1, cpt: "99213", modifiers: [], units: 1, chargeCents: 9000, dxPointers: [1] }] }), "CLIA")).toBeUndefined();
  });

  it("checks the referring NPI and warns about GZ on Medicare", () => {
    expect(find(claim({ encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9"], referringNpi: "1234567890" } }), "REFERRING_NPI")).toBeDefined();
    expect(find(claim({ encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9"], referringNpi: "1245319599" } }), "REFERRING_NPI")).toBeUndefined();
    const gz = [{ lineNumber: 1, cpt: "99213", modifiers: ["GZ"], units: 1, chargeCents: 9000, dxPointers: [1] }];
    expect(find(claim({ lines: gz }), "MEDICARE_GZ")?.severity).toBe("warning");
    expect(find(claim({ lines: gz, payer: { timelyFilingDays: 90, type: "commercial" } }), "MEDICARE_GZ")).toBeUndefined();
  });

  it("accepts every CMS place of service, like 03 (school) and 15 (mobile unit)", () => {
    for (const pos of ["03", "15", "10", "02"]) expect(find(claim({ encounter: { dateOfService: "2026-09-01", placeOfService: pos, diagnoses: ["E11.9"] } }), "POS")).toBeUndefined();
    expect(find(claim({ encounter: { dateOfService: "2026-09-01", placeOfService: "98", diagnoses: ["E11.9"] } }), "POS")).toBeDefined();
  });
});
