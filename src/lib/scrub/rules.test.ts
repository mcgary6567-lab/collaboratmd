import { describe, expect, it } from "vitest";
import { scrubClaim, hasBlockingErrors, isValidNpi, type ScrubClaim } from "./rules";

const base = (): ScrubClaim => ({
  patient: { firstName: "Maria", lastName: "Garcia", dob: "1980-04-12", sex: "F", address1: "1 Main St", zip: "32801" },
  insurance: { memberId: "ABC123", payerId: "00590", relationship: "self" },
  provider: { npi: "1234567893", taxonomy: "207Q00000X" },
  practice: { npi: "1234567893", taxId: "12-3456789" },
  encounter: { dateOfService: "2026-09-01", placeOfService: "11", diagnoses: ["E11.9", "I10"] },
  lines: [{ lineNumber: 1, cpt: "99214", modifiers: [], units: 1, chargeCents: 19500, dxPointers: [1, 2] }],
  payer: { timelyFilingDays: 90 },
  today: new Date("2026-09-21T00:00:00Z"),
});

describe("NPI validation", () => {
  it("accepts a valid NPI and rejects a bad check digit", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidNpi("12345")).toBe(false);
  });
});

describe("scrubClaim", () => {
  it("passes a clean claim", () => {
    const findings = scrubClaim(base());
    expect(findings.filter((f) => f.severity === "error")).toHaveLength(0);
    expect(hasBlockingErrors(findings)).toBe(false);
  });

  it("blocks missing diagnosis and bad pointers", () => {
    const c = base();
    c.encounter.diagnoses = [];
    const findings = scrubClaim(c);
    expect(findings.map((f) => f.rule)).toContain("DX_REQUIRED");
    expect(findings.map((f) => f.rule)).toContain("LINE_DX_POINTER");
    expect(hasBlockingErrors(findings)).toBe(true);
  });

  it("flags timely filing as error past the limit and warning near it", () => {
    const c = base();
    c.encounter.dateOfService = "2026-05-01";
    expect(scrubClaim(c).find((f) => f.rule === "TIMELY_FILING")?.severity).toBe("error");
    c.encounter.dateOfService = "2026-06-30"; // 83 days
    expect(scrubClaim(c).find((f) => f.rule === "TIMELY_FILING")?.severity).toBe("warning");
  });

  it("warns when E/M is billed with a procedure without modifier 25", () => {
    const c = base();
    c.lines.push({ lineNumber: 2, cpt: "20610", modifiers: [], units: 1, chargeCents: 15500, dxPointers: [1] });
    expect(scrubClaim(c).map((f) => f.rule)).toContain("EM_WITH_PROCEDURE");
    c.lines[0].modifiers = ["25"];
    expect(scrubClaim(c).map((f) => f.rule)).not.toContain("EM_WITH_PROCEDURE");
  });

  it("rejects invalid CPT, modifier, units and POS", () => {
    const c = base();
    c.lines[0].cpt = "9921";
    c.lines[0].modifiers = ["ABC"];
    c.lines[0].units = 0;
    c.encounter.placeOfService = "99";
    const rules = scrubClaim(c).map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(["LINE_CPT", "LINE_MODIFIER", "LINE_UNITS", "POS"]));
  });
});
