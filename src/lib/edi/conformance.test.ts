import { describe, expect, it } from "vitest";
import { buildEdi837P, type Edi837Input } from "./x837p";
import { buildEdi837I, type Edi837IInput } from "./x837i";
import { buildEdi837D } from "./x837d";
import { validateX12 } from "./validate";

const NOW = new Date("2026-09-21T14:30:00Z");
const billing = { name: "Lakeside Family Medicine", phone: "407-555-0100", npi: "1234567893", taxId: "12-3456789", address1: "410 Lakeside Ave", city: "Orlando", state: "FL", zip: "328011234" };
const subscriber = { lastName: "Garcia", firstName: "Maria", memberId: "ABC123", groupNumber: "GRP1", dob: "1980-04-12", sex: "F", address1: "1 Main St", city: "Orlando", state: "FL", zip: "32801", relationship: "self" };
const otherPayer = {
  name: "Aetna", payerId: "60054", subscriber: { lastName: "Garcia", firstName: "Maria", memberId: "W123", relationship: "self" },
  paidCents: 15000, adjudicatedOn: "2026-09-10", adjustments: [{ group: "CO", reason: "45", amountCents: 3000 }, { group: "PR", reason: "2", amountCents: 3000 }],
};

const professional = (over: Partial<Edi837Input> = {}, claim: Partial<Edi837Input["claim"]> = {}): Edi837Input => ({
  controlNumber: "CMD000001", interchangeControl: "123456789", senderId: "COLLABORATMD", receiverId: "00590", now: NOW,
  billingProvider: billing,
  renderingProvider: { lastName: "Chen", firstName: "Sarah", npi: "1234567893", taxonomy: "207Q00000X" },
  payer: { name: "BCBS FL", payerId: "00590" },
  subscriber,
  claim: { totalCents: 21000, placeOfService: "11", frequencyCode: "1", dateOfService: "2026-09-01", diagnoses: ["E11.9", "I10"], ...claim },
  lines: [
    { cpt: "99214", modifiers: ["25"], chargeCents: 19500, units: 1, dxPointers: [1, 2], dateOfService: "2026-09-01" },
    { cpt: "36415", modifiers: [], chargeCents: 1500, units: 1, dxPointers: [1], dateOfService: "2026-09-01" },
  ],
  ...over,
});

const institutional = (inpatient: boolean): Edi837IInput => ({
  controlNumber: "CMD000777", interchangeControl: "123456789", senderId: "COLLABORATMD", receiverId: "00430", now: NOW,
  billingProvider: billing,
  attending: { lastName: "Reyes", firstName: "Hannah", npi: "1234567893", taxonomy: "207R00000X" },
  payer: { name: "Medicare Part A", payerId: "00430", type: "medicare" },
  subscriber: { lastName: "Nguyen", firstName: "Linh", memberId: "1EG4TE5MK73", dob: "1950-04-05", sex: "F", relationship: "self" },
  claim: {
    totalCents: 125_000, frequencyCode: "1", diagnoses: ["I21.4", "E11.9"],
    institutional: inpatient
      ? { typeOfBill: "0111", statementFrom: "2026-09-10", statementTo: "2026-09-14", admissionDate: "2026-09-10", admissionHour: "1430", admissionType: "1", admissionSource: "7", patientStatus: "01", admittingDiagnosis: "R07.9" }
      : { typeOfBill: "0131", statementFrom: "2026-09-10", statementTo: "2026-09-10", patientStatus: "01" },
  },
  lines: [
    { revenueCode: "0120", chargeCents: 100_000, units: 4, dateOfService: "2026-09-10" },
    { revenueCode: "0450", hcpcs: "99284", chargeCents: 25_000, units: 1, dateOfService: "2026-09-10" },
  ],
} as Edi837IInput);

const CASES: [string, () => string][] = [
  ["837P original", () => buildEdi837P(professional())],
  ["837P replacement with prior authorization and attachment", () => buildEdi837P(professional({}, { frequencyCode: "7", originalPayerClaimNumber: "PCN12345", authorizationNumber: "AUTH9", attachments: [{ reportType: "OZ", transmission: "FX", controlNumber: "CMD000001A1" }] }))],
  ["837P secondary", () => buildEdi837P(professional({ otherPayer }))],
  ["837P at another location", () => buildEdi837P(professional({ serviceFacility: { name: "Northside Clinic", npi: "1234567893", address1: "500 North Rd", city: "Orlando", state: "FL", zip: "328031234" } }))],
  ["837I inpatient", () => buildEdi837I(institutional(true))],
  ["837I outpatient", () => buildEdi837I(institutional(false))],
  ["837D with tooth, surfaces and attachment", () => buildEdi837D({
    controlNumber: "CMD1", interchangeControl: "123", senderId: "COLLABORATMD", receiverId: "DDX", now: NOW,
    billingProvider: { ...billing, taxonomy: "1223G0001X" },
    rendering: { lastName: "Tooth", firstName: "Terry", npi: "1234567893", taxonomy: "1223G0001X" },
    payer: { name: "Delta", payerId: "DDX", type: "commercial" },
    subscriber: { lastName: "Doe", firstName: "Jane", memberId: "M1", dob: "1980-02-03", sex: "F", relationship: "self" },
    claim: { totalCents: 41_000, placeOfService: "11", frequencyCode: "1", diagnoses: [], attachments: [{ reportType: "RB", transmission: "FX", controlNumber: "CMD1A1" }] },
    lines: [
      { cdt: "D2392", chargeCents: 21_000, units: 1, dateOfService: "2026-09-01", tooth: "30", surfaces: "MO" },
      { cdt: "D4341", chargeCents: 20_000, units: 1, dateOfService: "2026-09-01", oralCavity: "10" },
    ],
  })],
];

describe("every claim file we build passes the structural checks", () => {
  for (const [name, build] of CASES) {
    it(name, () => {
      const r = validateX12(build());
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  }

  it("matches the reviewed 837P, so any change to the file is deliberate", async () => {
    await expect(buildEdi837P(professional())).toMatchFileSnapshot("./__golden__/837p-original.x12");
    await expect(buildEdi837I(institutional(true))).toMatchFileSnapshot("./__golden__/837i-inpatient.x12");
  });
});

describe("the checks catch real mistakes", () => {
  const good = buildEdi837P(professional());
  const errorsFor = (edi: string) => validateX12(edi).errors;

  it("segment count, control numbers and group counts", () => {
    expect(errorsFor(good.replace(/SE\*(\d+)\*0001/, (_, n) => `SE*${Number(n) + 1}*0001`))[0]).toMatch(/SE01 says/);
    expect(errorsFor(good.replace("IEA*1*123456789", "IEA*1*123456780"))[0]).toMatch(/IEA02/);
    expect(errorsFor(good.replace(/GE\*1\*/, "GE*2*"))[0]).toMatch(/GE01 says 2/);
  });

  it("charges that do not add up, bad NPIs, impossible dates and long fields", () => {
    expect(errorsFor(good.replace("CLM*CMD000001*210.00", "CLM*CMD000001*211.00"))).toContain("Claim CMD000001: CLM02 211.00 does not equal the service lines, 210.00");
    expect(errorsFor(good.replace("NM1*82*1*Chen*Sarah****XX*1234567893", "NM1*82*1*Chen*Sarah****XX*1234567890")).join()).toMatch(/fails the check digit/);
    expect(errorsFor(good.replace("DTP*472*D8*20260901", "DTP*472*D8*20260231")).join()).toMatch(/not a real date/);
    expect(errorsFor(good.replace("NM1*IL*1*Garcia", `NM1*IL*1*${"G".repeat(61)}`)).join()).toMatch(/NM103 is 61 characters/);
  });

  it("trailing separators, a broken HL tree and a malformed ISA", () => {
    expect(errorsFor(good.replace("REF*EI*123456789", "REF*EI*123456789*")).join()).toMatch(/ends with an empty element/);
    expect(errorsFor(good.replace(/HL\*2\*1\*22\*0/, "HL*2*1*22*1")).join()).toMatch(/HL04 is 1/);
    expect(errorsFor(good.replace(/HL\*2\*1\*/, "HL*2*9*")).join()).toMatch(/parent 9/);
    expect(errorsFor(good.replace("ISA*00*", "ISA*0*")).join()).toMatch(/ISA01 is 1 characters/);
  });
});
