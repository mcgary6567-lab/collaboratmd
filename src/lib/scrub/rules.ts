/**
 * Level-1 claim scrubbing engine.
 *
 * Rules are pure functions over a normalized claim snapshot so they can be
 * unit-tested without a database and evaluated in under a millisecond.
 * "error" blocks submission; "warning" allows submission with a note.
 */

export interface ScrubClaim {
  patient: { firstName: string; lastName: string; dob: string; sex: string; address1?: string | null; zip?: string | null };
  insurance: { memberId: string; payerId: string; relationship: string };
  provider: { npi: string; taxonomy: string };
  practice: { npi: string; taxId: string };
  encounter: { dateOfService: string; placeOfService: string; diagnoses: string[] };
  lines: { lineNumber: number; cpt: string; modifiers: string[]; units: number; chargeCents: number; dxPointers: number[] }[];
  payer: { timelyFilingDays: number };
  /** Frequency and replacement reference; absent means an original claim. */
  claim?: { frequencyCode: string; originalPayerClaimNumber?: string | null };
  today?: Date;
}

export interface ScrubFinding {
  rule: string;
  severity: "error" | "warning";
  message: string;
  field?: string;
}

type Rule = (c: ScrubClaim) => ScrubFinding[];

/** NPI check digit (Luhn with 80840 prefix). */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ("80840" + npi).split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = digits[i];
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

const ICD10_RE = /^[A-TV-Z][0-9][0-9AB](\.?[0-9A-TV-Z]{1,4})?$/i;
const CPT_RE = /^(\d{5}|[A-V]\d{4})$/; // CPT or HCPCS level II
const MODIFIER_RE = /^[A-Z0-9]{2}$/;
const VALID_POS = new Set(["02", "10", "11", "12", "19", "20", "21", "22", "23", "24", "31", "32", "34", "49", "50", "53", "62", "65", "71", "72", "81"]);

const rules: Record<string, Rule> = {
  PAT_REQUIRED: (c) => {
    const out: ScrubFinding[] = [];
    if (!c.patient.firstName?.trim()) out.push({ rule: "PAT_REQUIRED", severity: "error", message: "Patient first name is required", field: "patient.firstName" });
    if (!c.patient.lastName?.trim()) out.push({ rule: "PAT_REQUIRED", severity: "error", message: "Patient last name is required", field: "patient.lastName" });
    if (!c.patient.dob) out.push({ rule: "PAT_REQUIRED", severity: "error", message: "Patient date of birth is required", field: "patient.dob" });
    if (!["M", "F", "U"].includes(c.patient.sex)) out.push({ rule: "PAT_REQUIRED", severity: "error", message: "Patient sex must be M, F or U", field: "patient.sex" });
    return out;
  },
  PAT_ADDRESS: (c) =>
    !c.patient.address1 || !c.patient.zip
      ? [{ rule: "PAT_ADDRESS", severity: "warning", message: "Subscriber address is missing; many payers reject claims without it", field: "patient.address1" }]
      : [],
  DOB_FUTURE: (c) => {
    const today = c.today ?? new Date();
    return new Date(c.patient.dob) > today
      ? [{ rule: "DOB_FUTURE", severity: "error", message: "Patient date of birth is in the future", field: "patient.dob" }]
      : [];
  },
  INS_MEMBER_ID: (c) =>
    !c.insurance.memberId?.trim()
      ? [{ rule: "INS_MEMBER_ID", severity: "error", message: "Subscriber member ID is required", field: "insurance.memberId" }]
      : [],
  PAYER_ID: (c) =>
    !c.insurance.payerId?.trim()
      ? [{ rule: "PAYER_ID", severity: "error", message: "Payer has no clearinghouse payer ID configured", field: "payer.payerId" }]
      : [],
  PROV_NPI: (c) =>
    !isValidNpi(c.provider.npi)
      ? [{ rule: "PROV_NPI", severity: "error", message: `Rendering provider NPI ${c.provider.npi} fails check-digit validation`, field: "provider.npi" }]
      : [],
  BILLING_NPI: (c) =>
    !isValidNpi(c.practice.npi)
      ? [{ rule: "BILLING_NPI", severity: "error", message: `Billing provider NPI ${c.practice.npi} fails check-digit validation`, field: "practice.npi" }]
      : [],
  TAX_ID: (c) =>
    !/^\d{2}-?\d{7}$/.test(c.practice.taxId)
      ? [{ rule: "TAX_ID", severity: "error", message: "Billing provider Tax ID must be 9 digits", field: "practice.taxId" }]
      : [],
  TAXONOMY: (c) =>
    !/^[0-9A-Z]{9}X$/.test(c.provider.taxonomy)
      ? [{ rule: "TAXONOMY", severity: "warning", message: "Provider taxonomy code format looks invalid (expected 10 chars ending in X)", field: "provider.taxonomy" }]
      : [],
  DOS_FUTURE: (c) => {
    const today = c.today ?? new Date();
    return new Date(c.encounter.dateOfService) > today
      ? [{ rule: "DOS_FUTURE", severity: "error", message: "Date of service cannot be in the future", field: "encounter.dateOfService" }]
      : [];
  },
  TIMELY_FILING: (c) => {
    const today = c.today ?? new Date();
    const dos = new Date(c.encounter.dateOfService);
    const age = Math.floor((today.getTime() - dos.getTime()) / 86_400_000);
    const limit = c.payer.timelyFilingDays;
    if (age > limit) return [{ rule: "TIMELY_FILING", severity: "error", message: `Claim is ${age} days old and exceeds the payer timely filing limit of ${limit} days`, field: "encounter.dateOfService" }];
    if (age > limit - 15) return [{ rule: "TIMELY_FILING", severity: "warning", message: `Claim is ${age} days old; timely filing limit of ${limit} days is approaching`, field: "encounter.dateOfService" }];
    return [];
  },
  POS: (c) =>
    !VALID_POS.has(c.encounter.placeOfService)
      ? [{ rule: "POS", severity: "error", message: `Place of service ${c.encounter.placeOfService} is not a recognized CMS POS code`, field: "encounter.placeOfService" }]
      : [],
  DX_REQUIRED: (c) =>
    c.encounter.diagnoses.length === 0
      ? [{ rule: "DX_REQUIRED", severity: "error", message: "At least one ICD-10-CM diagnosis code is required", field: "encounter.diagnoses" }]
      : [],
  DX_FORMAT: (c) =>
    c.encounter.diagnoses
      .filter((d) => !ICD10_RE.test(d))
      .map((d) => ({ rule: "DX_FORMAT", severity: "error" as const, message: `Diagnosis code ${d} is not a valid ICD-10-CM format`, field: "encounter.diagnoses" })),
  DX_MAX: (c) =>
    c.encounter.diagnoses.length > 12
      ? [{ rule: "DX_MAX", severity: "error", message: "837P allows a maximum of 12 diagnosis codes", field: "encounter.diagnoses" }]
      : [],
  DX_DUPLICATE: (c) => {
    const seen = new Set<string>();
    const dupes = c.encounter.diagnoses.filter((d) => (seen.has(d) ? true : (seen.add(d), false)));
    return dupes.length ? [{ rule: "DX_DUPLICATE", severity: "warning", message: `Duplicate diagnosis codes: ${[...new Set(dupes)].join(", ")}`, field: "encounter.diagnoses" }] : [];
  },
  LINES_REQUIRED: (c) =>
    c.lines.length === 0 ? [{ rule: "LINES_REQUIRED", severity: "error", message: "Claim has no service lines" }] : [],
  LINES_MAX: (c) =>
    c.lines.length > 50 ? [{ rule: "LINES_MAX", severity: "error", message: "837P allows a maximum of 50 service lines" }] : [],
  LINE_CPT: (c) =>
    c.lines
      .filter((l) => !CPT_RE.test(l.cpt))
      .map((l) => ({ rule: "LINE_CPT", severity: "error" as const, message: `Line ${l.lineNumber}: procedure code ${l.cpt} is not a valid CPT/HCPCS format`, field: `lines.${l.lineNumber}.cpt` })),
  LINE_MODIFIER: (c) =>
    c.lines
      .flatMap((l) => l.modifiers.filter((m) => !MODIFIER_RE.test(m)).map((m) => ({ l, m })))
      .map(({ l, m }) => ({ rule: "LINE_MODIFIER", severity: "error" as const, message: `Line ${l.lineNumber}: modifier ${m} must be 2 alphanumeric characters`, field: `lines.${l.lineNumber}.modifiers` })),
  LINE_UNITS: (c) =>
    c.lines
      .filter((l) => !Number.isInteger(l.units) || l.units < 1)
      .map((l) => ({ rule: "LINE_UNITS", severity: "error" as const, message: `Line ${l.lineNumber}: units must be a positive integer`, field: `lines.${l.lineNumber}.units` })),
  LINE_CHARGE: (c) =>
    c.lines
      .filter((l) => l.chargeCents <= 0)
      .map((l) => ({ rule: "LINE_CHARGE", severity: "error" as const, message: `Line ${l.lineNumber}: charge amount must be greater than zero`, field: `lines.${l.lineNumber}.chargeCents` })),
  LINE_DX_POINTER: (c) =>
    c.lines
      .filter((l) => l.dxPointers.length === 0 || l.dxPointers.some((p) => p < 1 || p > c.encounter.diagnoses.length))
      .map((l) => ({ rule: "LINE_DX_POINTER", severity: "error" as const, message: `Line ${l.lineNumber}: diagnosis pointer references a diagnosis that does not exist`, field: `lines.${l.lineNumber}.dxPointers` })),
  LINE_DUPLICATE: (c) => {
    const seen = new Set<string>();
    const out: ScrubFinding[] = [];
    for (const l of c.lines) {
      const key = `${l.cpt}|${l.modifiers.slice().sort().join(",")}`;
      if (seen.has(key)) out.push({ rule: "LINE_DUPLICATE", severity: "warning", message: `Line ${l.lineNumber}: ${l.cpt} appears more than once with the same modifiers; payers may flag as duplicate`, field: `lines.${l.lineNumber}.cpt` });
      seen.add(key);
    }
    return out;
  },
  FREQ_REFERENCE: (c) =>
    c.claim && ["7", "8"].includes(c.claim.frequencyCode) && !c.claim.originalPayerClaimNumber?.trim()
      ? [{ rule: "FREQ_REFERENCE", severity: "error", message: `A ${c.claim.frequencyCode === "7" ? "replacement" : "void"} claim must reference the payer's original claim number; the payer rejects it otherwise`, field: "claim.originalPayerClaimNumber" }]
      : [],
  EM_WITH_PROCEDURE: (c) => {
    const hasEm = c.lines.some((l) => /^99(2|3|4)\d{2}$/.test(l.cpt));
    const hasProc = c.lines.some((l) => !/^99\d{3}$/.test(l.cpt));
    const emHas25 = c.lines.filter((l) => /^99(2|3|4)\d{2}$/.test(l.cpt)).every((l) => l.modifiers.includes("25"));
    return hasEm && hasProc && !emHas25
      ? [{ rule: "EM_WITH_PROCEDURE", severity: "warning", message: "E/M service billed with a procedure on the same day usually requires modifier 25 on the E/M line" }]
      : [];
  },
};

export function scrubClaim(claim: ScrubClaim): ScrubFinding[] {
  const findings: ScrubFinding[] = [];
  for (const rule of Object.values(rules)) findings.push(...rule(claim));
  return findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

export function hasBlockingErrors(findings: ScrubFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}

export const RULE_IDS = Object.keys(rules);
