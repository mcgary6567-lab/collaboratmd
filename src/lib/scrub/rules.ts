/**
 * Level-1 claim scrubbing engine.
 *
 * Rules are pure functions over a normalized claim snapshot so they can be
 * unit-tested without a database and evaluated in under a millisecond.
 * "error" blocks submission; "warning" allows submission with a note.
 */
import { isDrugCode, isNdcUnit } from "@/lib/codes/ndc";
import { isZeroChargeCode } from "@/lib/codes/quality";
import { isUnlistedCode } from "@/lib/codes/unlisted";
import { POS_CODES } from "@/lib/codes/pos";
import { ICD10CM_RE } from "@/lib/codes/icd";
import { CLIA_RE, isLabCode } from "@/lib/codes/lab";
import { ANESTHESIA_MODIFIERS, EM_TIME_MINIMUM, THERAPY_MODIFIERS, TIMED_THERAPY_CODES, eightMinuteRule, isAnesthesiaCode, isOfficeEm, isTherapyCode, levelForMinutes, prolongedUnits } from "@/lib/time-units";

export interface ScrubClaim {
  patient: { firstName: string; lastName: string; dob: string; sex: string; address1?: string | null; zip?: string | null };
  insurance: { memberId: string; payerId: string; relationship: string; subscriber?: { firstName: string | null; lastName: string | null; dob: string | null } | null };
  provider: { npi: string; taxonomy: string; credential?: string | null };
  /** The supervising physician (2310D), when there is one. */
  supervisor?: { npi: string; credential?: string | null; name: string } | null;
  practice: { npi: string; taxId: string; phone?: string | null; cliaNumber?: string | null };
  encounter: {
    dateOfService: string; placeOfService: string; diagnoses: string[]; referringNpi?: string | null;
    /** Work and accident details (box 10, CLM11), and the insurer's claim number for workers' comp and auto. */
    relatedEmployment?: boolean; relatedAuto?: boolean; autoAccidentState?: string | null; relatedOther?: boolean; accidentDate?: string | null; propertyClaimNumber?: string | null;
    /** Split/shared facility visit: the other practitioner, and the attestation that the billing one did the substantive portion. */
    sharedWith?: { npi: string; name: string } | null; substantiveAttested?: boolean;
    /** Teaching setting: the teaching physician was present for the key or critical portion. */
    teachingPresent?: boolean;
  };
  lines: { lineNumber: number; cpt: string; modifiers: string[]; units: number; chargeCents: number; dxPointers: number[]; minutes?: number | null; ndc?: string | null; ndcUnit?: string | null; ndcQuantity?: number | null; description?: string | null }[];
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

const ICD10_RE = ICD10CM_RE;
const CPT_RE = /^(\d{5}|[A-V]\d{4})$/; // CPT or HCPCS level II
const MODIFIER_RE = /^[A-Z0-9]{2}$/;
// The full CMS list (lib/codes/pos.ts): what charge entry offers is what the scrubber accepts.
const VALID_POS = POS_CODES;
export const TELEHEALTH_POS = new Set(["02", "10"]);
const EM_RE = /^99(2[0-9]{2}|3[0-4][0-9]|4[0-9]{2})$/;
/** Codes the primary care exception covers (with GE); the full list is CMS's. */
const PRIMARY_CARE_EXCEPTION = new Set(["99202", "99203", "99211", "99212", "99213", "G0402", "G0438", "G0439"]);
export const TELEHEALTH_MODIFIERS = new Set(["95", "93", "FQ", "GT", "GQ", "FR"]);

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
  SUPERVISING: (c) => {
    if (!c.supervisor) return [];
    if (!isValidNpi(c.supervisor.npi)) return [{ rule: "SUPERVISING", severity: "error", message: `Supervising provider ${c.supervisor.name}'s NPI ${c.supervisor.npi} fails check-digit validation`, field: "encounter.supervisingProviderId" }];
    if (c.supervisor.npi === c.provider.npi) return [{ rule: "SUPERVISING", severity: "error", message: "The supervising provider is the same as the rendering provider: leave supervising empty, or choose the physician who supervised", field: "encounter.supervisingProviderId" }];
    return [];
  },
  REFERRING_NPI: (c) =>
    c.encounter.referringNpi && !isValidNpi(c.encounter.referringNpi)
      ? [{ rule: "REFERRING_NPI", severity: "error", message: `Referring provider NPI ${c.encounter.referringNpi} fails check-digit validation`, field: "encounter.referringNpi" }]
      : [],
  NDC: (c) => c.lines.flatMap((l) => {
    const field = `lines.${l.lineNumber}.ndc`;
    if (l.ndc) {
      if (!/^\d{11}$/.test(l.ndc)) return [{ rule: "NDC", severity: "error" as const, message: `Line ${l.lineNumber}: ${l.ndc} is not an 11-digit NDC`, field }];
      if (!isNdcUnit(l.ndcUnit) || !(Number(l.ndcQuantity) > 0)) return [{ rule: "NDC", severity: "error" as const, message: `Line ${l.lineNumber}: give the drug quantity and its unit (UN, ML, GR, F2 or ME) with the NDC`, field }];
      return [];
    }
    if (!isDrugCode(l.cpt)) return [];
    return [{ rule: "NDC", severity: c.payer.type === "medicaid" ? "error" as const : "warning" as const, message: `Line ${l.lineNumber}: drug code ${l.cpt} needs the NDC from the package${c.payer.type === "medicaid" ? " (Medicaid requires it)" : "; most payers require it"}`, field }];
  }),
  // Office E/M chosen by time: the minutes recorded must reach the level, and prolonged time is its own code.
  EM_TIME: (c) => {
    const out: ScrubFinding[] = [];
    const medicare = c.payer.type === "medicare";
    for (const l of c.lines) {
      if (!isOfficeEm(l.cpt) || !l.minutes) continue;
      const need = EM_TIME_MINIMUM[l.cpt];
      if (l.minutes < need) {
        const fits = levelForMinutes(l.cpt, l.minutes);
        out.push({ rule: "EM_TIME", severity: "warning", message: `Line ${l.lineNumber}: ${l.cpt} by time needs ${need} minutes; ${l.minutes} supports ${fits ?? "no level by time"}. Bill ${l.cpt} only if medical decision making supports it.`, field: `lines.${l.lineNumber}.minutes` });
      }
    }
    const top = c.lines.find((l) => (l.cpt === "99205" || l.cpt === "99215") && l.minutes);
    const billed = (code: string) => c.lines.filter((l) => l.cpt === code).reduce((a, l) => a + l.units, 0);
    const [p99417, pG2212] = [billed("99417"), billed("G2212")];
    if (medicare && p99417) out.push({ rule: "PROLONGED", severity: "error", message: "Medicare does not pay 99417: bill prolonged office time as G2212, which starts at 89 minutes (99205) or 69 minutes (99215)", field: "lines" });
    if (!medicare && pG2212) out.push({ rule: "PROLONGED", severity: "warning", message: "G2212 is Medicare's prolonged service code; most other payers want 99417", field: "lines" });
    const billedUnits = medicare ? pG2212 : p99417;
    const code = medicare ? "G2212" : "99417";
    if (billedUnits) {
      const allowed = top ? prolongedUnits(top.cpt, top.minutes!, medicare) : 0;
      if (!top) out.push({ rule: "PROLONGED", severity: "error", message: `${code} goes with 99205 or 99215 chosen by time: record the total minutes on that line`, field: "lines" });
      else if (billedUnits > allowed) out.push({ rule: "PROLONGED", severity: "error", message: `${billedUnits} unit${billedUnits === 1 ? "" : "s"} of ${code} billed, but ${top.minutes} minutes with ${top.cpt} support ${allowed}`, field: "lines" });
    } else if (top) {
      const units = prolongedUnits(top.cpt, top.minutes!, medicare);
      if (units > 0) out.push({ rule: "PROLONGED", severity: "warning", message: `${top.minutes} minutes with ${top.cpt} support ${units} unit${units === 1 ? "" : "s"} of prolonged service ${code}; add it if the time is documented`, field: "lines" });
    }
    return out;
  },
  UNLISTED: (c) =>
    c.lines
      .filter((l) => isUnlistedCode(l.cpt) && (l.description ?? "").trim().length < 5)
      .map((l) => ({ rule: "UNLISTED", severity: "error" as const, message: `Line ${l.lineNumber}: ${l.cpt} is an unlisted or unclassified code; describe the service on the line (it goes on the claim), and have the records ready`, field: `lines.${l.lineNumber}.description` })),
  THERAPY_MODIFIER: (c) =>
    c.lines
      .filter((l) => isTherapyCode(l.cpt) && !l.modifiers.some((m) => THERAPY_MODIFIERS.includes(m.toUpperCase())))
      .map((l) => ({ rule: "THERAPY_MODIFIER", severity: c.payer.type === "medicare" ? "error" as const : "warning" as const, message: `Line ${l.lineNumber}: therapy code ${l.cpt} needs GP (physical therapy), GO (occupational) or GN (speech-language)`, field: `lines.${l.lineNumber}.modifiers` })),
  THERAPY_UNITS: (c) => {
    if (c.payer.type !== "medicare" && c.payer.type !== "medicaid") return [];
    const timed = c.lines.filter((l) => TIMED_THERAPY_CODES.has(l.cpt));
    if (!timed.length) return [];
    if (timed.some((l) => !l.minutes)) return [{ rule: "THERAPY_UNITS", severity: "warning", message: "Enter the minutes for each timed therapy code, so the units can be checked against the 8-minute rule", field: "lines" }];
    const allowed = eightMinuteRule(timed.map((l) => ({ code: l.cpt, minutes: l.minutes ?? 0 })));
    const billed = timed.reduce((a, l) => a + l.units, 0);
    const most = [...allowed.values()].reduce((a, n) => a + n, 0);
    return billed > most ? [{ rule: "THERAPY_UNITS", severity: "error", message: `${billed} timed therapy units billed, but ${timed.reduce((a, l) => a + (l.minutes ?? 0), 0)} minutes allow ${most} under the 8-minute rule`, field: "lines" }] : [];
  },
  ANESTHESIA: (c) => c.lines.filter((l) => isAnesthesiaCode(l.cpt)).flatMap((l) => [
    ...(!l.minutes ? [{ rule: "ANESTHESIA_MINUTES", severity: "error" as const, message: `Line ${l.lineNumber}: anesthesia ${l.cpt} is billed in minutes; enter the anesthesia time`, field: `lines.${l.lineNumber}.minutes` }] : []),
    ...(!l.modifiers.some((m) => ANESTHESIA_MODIFIERS.includes(m.toUpperCase())) ? [{ rule: "ANESTHESIA_MODIFIER", severity: c.payer.type === "medicare" ? "error" as const : "warning" as const, message: `Line ${l.lineNumber}: add who gave the anesthesia (AA, AD, QK, QX, QY or QZ)`, field: `lines.${l.lineNumber}.modifiers` }] : []),
  ]),
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
  // Telehealth: POS 02 (not at home) or 10 (at home), 95 for audio and video, 93 (FQ at a clinic) for audio only.
  TELEHEALTH: (c) => {
    const out: ScrubFinding[] = [];
    const pos = c.encounter.placeOfService;
    const upper = c.lines.map((l) => ({ l, m: l.modifiers.map((x) => x.toUpperCase()) }));
    for (const { l, m } of upper) {
      if (m.includes("95") && (m.includes("93") || m.includes("FQ"))) out.push({ rule: "TELEHEALTH_MODIFIER", severity: "error", message: `Line ${l.lineNumber}: 95 means audio and video, 93 and FQ mean audio only; use one`, field: `lines.${l.lineNumber}.modifiers` });
    }
    if (c.payer.type === "medicare" && upper.some(({ m }) => m.includes("GT"))) {
      out.push({ rule: "TELEHEALTH_GT", severity: "warning", message: "Medicare stopped using GT in 2018 (except critical access hospitals billing method II): bill place of service 02 or 10 and modifier 95 or 93 as needed", field: "lines.modifiers" });
    }
    if (TELEHEALTH_POS.has(pos) && c.payer.type !== "medicare" && !upper.some(({ m }) => m.some((x) => TELEHEALTH_MODIFIERS.has(x)))) {
      out.push({ rule: "TELEHEALTH_MODIFIER", severity: "warning", message: `Place of service ${pos} is telehealth; most plans other than Medicare also want modifier 95 (audio and video) or 93 (audio only) on each line. Check this payer's policy.`, field: "lines.modifiers" });
    }
    return out;
  },
  // Split/shared E/M in a facility: billed by the practitioner who did the substantive portion, with FS.
  SPLIT_SHARED: (c) => {
    const out: ScrubFinding[] = [];
    const em = c.lines.filter((l) => EM_RE.test(l.cpt));
    const fs = c.lines.filter((l) => l.modifiers.map((m) => m.toUpperCase()).includes("FS"));
    const shared = c.encounter.sharedWith;
    if (!shared) {
      if (fs.length) out.push({ rule: "SPLIT_SHARED", severity: "warning", message: "FS marks a split/shared visit: name the other practitioner who shared it", field: "encounter.sharedWith" });
      return out;
    }
    const strict = c.payer.type === "medicare" || c.payer.type === "medicaid";
    if (shared.npi === c.provider.npi) out.push({ rule: "SPLIT_SHARED", severity: "error", message: "The practitioner the visit was shared with is the billing practitioner: choose the other one", field: "encounter.sharedWith" });
    if (!c.encounter.substantiveAttested) out.push({ rule: "SPLIT_SHARED", severity: strict ? "error" : "warning", message: "Attest that the billing practitioner performed the substantive portion of the visit (more than half the total time, or the substantive part of medical decision making)", field: "encounter.substantiveAttested" });
    if (["11", "02", "10", "12"].includes(c.encounter.placeOfService)) out.push({ rule: "SPLIT_SHARED", severity: "warning", message: "Split/shared billing applies in facility settings (hospital, skilled nursing). In the office, bill under the practitioner who did the visit, or as incident-to when its rules are met.", field: "encounter.placeOfService" });
    for (const l of em) if (!l.modifiers.map((m) => m.toUpperCase()).includes("FS")) out.push({ rule: "SPLIT_SHARED", severity: strict ? "error" : "warning", message: `Line ${l.lineNumber}: a split/shared visit carries modifier FS`, field: `lines.${l.lineNumber}.modifiers` });
    return out;
  },
  // Teaching physicians: GC (a resident took part, the teaching physician was present) or GE (primary care exception).
  TEACHING: (c) => {
    const out: ScrubFinding[] = [];
    for (const l of c.lines) {
      const m = l.modifiers.map((x) => x.toUpperCase());
      const field = `lines.${l.lineNumber}.modifiers`;
      if (m.includes("GC") && m.includes("GE")) out.push({ rule: "TEACHING", severity: "error", message: `Line ${l.lineNumber}: GC and GE cannot both apply; GE is only for the primary care exception`, field });
      else if (m.includes("GC") && !c.encounter.teachingPresent) out.push({ rule: "TEACHING", severity: c.payer.type === "medicare" ? "error" : "warning", message: `Line ${l.lineNumber}: GC says the teaching physician was present for the key or critical portion; record that on the visit`, field });
      else if (m.includes("GE") && !PRIMARY_CARE_EXCEPTION.has(l.cpt.toUpperCase())) out.push({ rule: "TEACHING", severity: "warning", message: `Line ${l.lineNumber}: GE (primary care exception) covers lower-level visits such as 99202-99203 and 99211-99213 and a few others on CMS's list; ${l.cpt} is probably not one of them`, field });
    }
    return out;
  },
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
      .filter((l) => l.chargeCents <= 0 && !isZeroChargeCode(l.cpt))
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
