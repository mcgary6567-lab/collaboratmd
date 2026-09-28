/**
 * Level-1 claim scrubbing engine.
 *
 * Rules are pure functions over a normalized claim snapshot so they can be
 * unit-tested without a database and evaluated in under a millisecond.
 * "error" blocks submission; "warning" allows submission with a note.
 */
import { POS_CODES } from "@/lib/codes/pos";
import { CLIA_RE, isLabCode } from "@/lib/codes/lab";

export interface ScrubClaim {
  patient: { firstName: string; lastName: string; dob: string; sex: string; address1?: string | null; zip?: string | null };
  insurance: { memberId: string; payerId: string; relationship: string; subscriber?: { firstName: string | null; lastName: string | null; dob: string | null } | null };
  provider: { npi: string; taxonomy: string };
  practice: { npi: string; taxId: string; phone?: string | null; cliaNumber?: string | null };
  encounter: {
    dateOfService: string; placeOfService: string; diagnoses: string[]; referringNpi?: string | null;
    /** Work and accident details (box 10, CLM11), and the insurer's claim number for workers' comp and auto. */
    relatedEmployment?: boolean; relatedAuto?: boolean; autoAccidentState?: string | null; relatedOther?: boolean; accidentDate?: string | null; propertyClaimNumber?: string | null;
  };
  lines: { lineNumber: number; cpt: string; modifiers: string[]; units: number; chargeCents: number; dxPointers: number[] }[];
  payer: { timelyFilingDays: number; type?: string | null };
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

/**
 * The Medicare Beneficiary Identifier's shape (CMS): 11 characters, dashes
 * optional; digits and letters by position, the letters never S, L, O, I, B or Z.
 */
export function isValidMbi(id: string): boolean {
  const L = "[AC-HJKMNP-RT-Y]";
  return new RegExp(`^[1-9]${L}[0-9AC-HJKMNP-RT-Y][0-9]${L}[0-9AC-HJKMNP-RT-Y][0-9]${L}${L}[0-9][0-9]$`).test(id.replace(/-/g, "").toUpperCase());
}

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
// The full CMS list (lib/codes/pos.ts): what charge entry offers is what the scrubber accepts.
const VALID_POS = POS_CODES;

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
  // A dependent's claim names the insured person as the subscriber (lib/edi/subscriber.ts): without them the payer rejects it.
  SUBSCRIBER_DEPENDENT: (c) =>
    c.insurance.relationship !== "self" && !(c.insurance.subscriber?.firstName?.trim() && c.insurance.subscriber?.lastName?.trim() && c.insurance.subscriber?.dob)
      ? [{ rule: "SUBSCRIBER_DEPENDENT", severity: "error", message: `The patient is the insured's ${c.insurance.relationship === "other" ? "dependent" : c.insurance.relationship}: enter the insured person's name and date of birth on the insurance`, field: "insurance.subscriber" }]
      : [],
  // Laboratory tests go out with the lab's CLIA certificate number; Medicare denies them without it.
  CLIA: (c) => {
    if (!c.lines.some((l) => isLabCode(l.cpt))) return [];
    const clia = c.practice.cliaNumber?.trim().toUpperCase();
    if (clia && CLIA_RE.test(clia)) return [];
    const message = clia ? `CLIA number ${clia} is not valid (2 digits, D, 7 digits)` : "The claim has laboratory tests but the practice has no CLIA number (Settings > Practice profile)";
    return [{ rule: "CLIA", severity: c.payer.type === "medicare" || clia ? "error" : "warning", message, field: "practice.cliaNumber" }];
  },
  REFERRING_NPI: (c) =>
    c.encounter.referringNpi && !isValidNpi(c.encounter.referringNpi)
      ? [{ rule: "REFERRING_NPI", severity: "error", message: `Referring provider NPI ${c.encounter.referringNpi} fails check-digit validation`, field: "encounter.referringNpi" }]
      : [],
  ACCIDENT_STATE: (c) =>
    c.encounter.relatedAuto && !c.encounter.autoAccidentState
      ? [{ rule: "ACCIDENT_STATE", severity: "error", message: "An auto accident claim needs the state where the accident happened", field: "encounter.autoAccidentState" }]
      : [],
  ACCIDENT_DATE: (c) =>
    (c.encounter.relatedAuto || c.encounter.relatedOther || c.payer.type === "workers_comp") && !c.encounter.accidentDate
      ? [{ rule: "ACCIDENT_DATE", severity: "error", message: "Enter the date of the accident or injury", field: "encounter.accidentDate" }]
      : c.encounter.accidentDate && c.encounter.accidentDate > c.encounter.dateOfService
        ? [{ rule: "ACCIDENT_DATE", severity: "error", message: "The accident date is after the date of service", field: "encounter.accidentDate" }]
        : [],
  WORKERS_COMP: (c) =>
    c.payer.type === "workers_comp" && !c.encounter.relatedEmployment
      ? [{ rule: "WORKERS_COMP", severity: "error", message: "A workers' comp claim must say the condition is related to employment (box 10a)", field: "encounter.relatedEmployment" }]
      : [],
  AUTO_CLAIM: (c) =>
    c.payer.type === "auto" && !c.encounter.relatedAuto
      ? [{ rule: "AUTO_CLAIM", severity: "warning", message: "The payer is an auto insurer but the claim does not say the condition is from an auto accident (box 10b)", field: "encounter.relatedAuto" }]
      : [],
  PC_CLAIM_NUMBER: (c) =>
    (c.payer.type === "workers_comp" || c.payer.type === "auto") && !c.encounter.propertyClaimNumber?.trim()
      ? [{ rule: "PC_CLAIM_NUMBER", severity: "warning", message: "Workers' comp and auto insurers expect their own claim number for the injury (box 11b); most return claims without it", field: "encounter.propertyClaimNumber" }]
      : [],
  // GZ: the provider expects Medicare to deny the service and has no signed ABN, so the patient cannot be billed for it.
  MEDICARE_GZ: (c) =>
    c.payer.type === "medicare" && c.lines.some((l) => l.modifiers.includes("GZ"))
      ? [{ rule: "MEDICARE_GZ", severity: "warning", message: "A line has modifier GZ: Medicare will likely deny it and, without a signed ABN, the patient cannot be billed. Use GA when an ABN is on file.", field: "lines.modifiers" }]
      : [],
  // Traditional Medicare takes the Medicare Beneficiary Identifier; the old SSN-based HICN is refused.
  MEDICARE_MBI: (c) =>
    c.payer.type === "medicare" && c.insurance.memberId?.trim() && !isValidMbi(c.insurance.memberId)
      ? [{ rule: "MEDICARE_MBI", severity: "error", message: `Medicare member ID ${c.insurance.memberId} is not an MBI (11 characters, like 1EG4-TE5-MK73)`, field: "insurance.memberId" }]
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
  BILLING_PHONE: (c) =>
    c.practice.phone !== undefined && !/^1?\d{10}$/.test((c.practice.phone ?? "").replace(/\D/g, ""))
      ? [{ rule: "BILLING_PHONE", severity: "error", message: "The practice phone number is missing or invalid; claims carry it as the contact for the payer", field: "practice.phone" }]
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
