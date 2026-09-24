import { describe, expect, it } from "vitest";
import { evaluatePayerEdits, findAuthorization, type AuthOnFile, type PayerEditRule } from "./payer-edits";
import { scrubClaim, type ScrubClaim } from "./rules";

const claim = {
  dateOfService: "2026-09-20",
  diagnoses: ["E78.5"],
  lines: [
    { lineNumber: 1, cpt: "70553", modifiers: [], units: 1 },
    { lineNumber: 2, cpt: "80061", modifiers: [], units: 1 },
  ],
};
const rule = (r: Partial<PayerEditRule>): PayerEditRule => ({ id: "r", kind: "auth_required", cpt: null, params: {}, severity: "error", message: "rule message", ...r });
const auth = (a: Partial<AuthOnFile>): AuthOnFile => ({ id: "a1", authNumber: "AUTH1", cpts: ["70553"], unitsApproved: 1, unitsUsed: 0, validFrom: "2026-09-01", validTo: "2026-09-30", status: "active", ...a });

describe("prior authorization", () => {
  const needsAuth = rule({ kind: "auth_required", cpt: "70553", message: "Prior authorization required" });

  it("blocks the claim when no authorization is on file", () => {
    const r = evaluatePayerEdits(claim, [needsAuth], []);
    expect(r.findings).toEqual([{ rule: "PAYER_AUTH", severity: "error", message: "Line 1 (70553): Prior authorization required", field: "lines.1.cpt" }]);
    expect(r.authorization).toBeNull();
  });

  it("passes with a covering authorization and reports it for REF*G1", () => {
    const r = evaluatePayerEdits(claim, [needsAuth], [auth({})]);
    expect(r.findings).toEqual([]);
    expect(r.authorization?.authNumber).toBe("AUTH1");
    expect(r.authUnits).toBe(1);
  });

  it("does not accept an authorization outside its dates, used up, or cancelled", () => {
    expect(findAuthorization([auth({ validTo: "2026-09-19" })], "70553", "2026-09-20", 1)).toBeNull();
    expect(findAuthorization([auth({ unitsUsed: 1 })], "70553", "2026-09-20", 1)).toBeNull();
    expect(findAuthorization([auth({ status: "cancelled" })], "70553", "2026-09-20", 1)).toBeNull();
    expect(findAuthorization([auth({ unitsApproved: null, unitsUsed: 99 })], "70553", "2026-09-20", 1)).not.toBeNull();
  });
});

describe("other payer edits", () => {
  it("requires a qualifying diagnosis by prefix, ignoring the dot", () => {
    const lipid = rule({ kind: "dx_required", cpt: "80061", params: { dxPrefixes: ["E78", "Z13.220"] }, message: "Needs a lipid disorder diagnosis" });
    expect(evaluatePayerEdits(claim, [lipid], []).findings).toEqual([]);
    expect(evaluatePayerEdits({ ...claim, diagnoses: ["I10"] }, [lipid], []).findings[0].rule).toBe("PAYER_DX");
    expect(evaluatePayerEdits({ ...claim, diagnoses: ["Z13220"] }, [lipid], []).findings).toEqual([]);
  });

  it("requires one of a set of modifiers", () => {
    const tc = rule({ kind: "modifier_required", cpt: "70553", params: { modifiers: ["26", "TC"] }, message: "Bill the professional or technical component" });
    expect(evaluatePayerEdits(claim, [tc], []).findings).toHaveLength(1);
    const withMod = { ...claim, lines: [{ ...claim.lines[0], modifiers: ["26"] }, claim.lines[1]] };
    expect(evaluatePayerEdits(withMod, [tc], []).findings).toEqual([]);
  });

  it("enforces unit limits and flags uncovered codes, honoring warning severity", () => {
    const units = rule({ kind: "max_units", cpt: "80061", params: { maxUnits: 1 }, message: "One per day" });
    expect(evaluatePayerEdits({ ...claim, lines: [{ ...claim.lines[1], units: 2 }] }, [units], []).findings[0].rule).toBe("PAYER_UNITS");
    const excluded = rule({ kind: "not_covered", cpt: "80061", severity: "warning", message: "Not covered by this plan" });
    expect(evaluatePayerEdits(claim, [excluded], []).findings[0]).toMatchObject({ rule: "PAYER_NOT_COVERED", severity: "warning" });
  });

  it("ignores rules for codes not on the claim", () => {
    expect(evaluatePayerEdits(claim, [rule({ kind: "not_covered", cpt: "99999" })], []).findings).toEqual([]);
  });
});

describe("replacement and void references", () => {
  const scrub: ScrubClaim = {
    patient: { firstName: "Jane", lastName: "Doe", dob: "1980-01-01", sex: "F", address1: "1 Main", zip: "75201" },
    insurance: { memberId: "A1", payerId: "60054", relationship: "self" },
    provider: { npi: "1234567893", taxonomy: "207Q00000X" },
    practice: { npi: "1234567893", taxId: "84-2917465" },
    encounter: { dateOfService: "2026-09-20", placeOfService: "11", diagnoses: ["E11.9"] },
    lines: [{ lineNumber: 1, cpt: "99213", modifiers: [], units: 1, chargeCents: 10_000, dxPointers: [1] }],
    payer: { timelyFilingDays: 90 },
    today: new Date("2026-09-24"),
  };

  it("blocks a frequency 7 or 8 claim that lacks the payer's original claim number", () => {
    const rules = (c: ScrubClaim) => scrubClaim(c).filter((f) => f.rule === "FREQ_REFERENCE");
    expect(rules({ ...scrub, claim: { frequencyCode: "7", originalPayerClaimNumber: null } })).toHaveLength(1);
    expect(rules({ ...scrub, claim: { frequencyCode: "8", originalPayerClaimNumber: "PCN1" } })).toHaveLength(0);
    expect(rules({ ...scrub, claim: { frequencyCode: "1" } })).toHaveLength(0);
  });
});
