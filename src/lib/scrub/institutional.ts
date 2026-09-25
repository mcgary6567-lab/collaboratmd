/**
 * Scrubber rules for institutional (837I / UB-04) claims. The professional
 * rules check a place of service and CPT on every line; a facility claim is
 * judged on its type of bill, statement period, admission details and
 * revenue codes instead.
 */
import type { ScrubFinding } from "./rules";
import { isValidNpi } from "./rules";
import { isInpatient, type Institutional } from "@/lib/edi/x837i";

export type InstitutionalScrubInput = {
  institutional: Institutional | null;
  billingNpi: string;
  attendingNpi: string;
  memberId: string;
  payerId: string;
  diagnoses: string[];
  lines: { lineNumber: number; revenueCode: string | null; hcpcs: string; units: number; chargeCents: number }[];
  today?: string;
};

/** Outpatient bill types where Medicare and most payers expect HCPCS on the lines. */
const OUTPATIENT_HCPCS = ["13", "14", "71", "73", "74", "75", "76", "77", "83", "85"];
/** Revenue codes billed without HCPCS: room and board, pharmacy, supplies. */
const NO_HCPCS_REVENUE = /^0(1\d\d|2[0-1]\d|25\d|27\d|63\d)$/;

export function scrubInstitutional(c: InstitutionalScrubInput): ScrubFinding[] {
  const out: ScrubFinding[] = [];
  const err = (rule: string, message: string, field?: string) => out.push({ rule, severity: "error", message, field });
  const warn = (rule: string, message: string, field?: string) => out.push({ rule, severity: "warning", message, field });
  const today = c.today ?? new Date().toISOString().slice(0, 10);
  const i = c.institutional;
  if (!i) {
    err("INST_MISSING", "Institutional claim details (type of bill, statement period) are missing", "institutional");
    return out;
  }
  const tob = i.typeOfBill.padStart(4, "0");
  if (!/^0\d{2}[0-9A-Z]$/.test(tob)) err("TOB_FORMAT", `Type of bill "${i.typeOfBill}" must be four characters, like 0131`, "institutional.typeOfBill");
  if (!i.statementFrom || !i.statementTo) err("STATEMENT_DATES", "Enter the statement period (from and through dates)", "institutional.statementFrom");
  else {
    if (i.statementTo < i.statementFrom) err("STATEMENT_ORDER", "The statement period ends before it starts", "institutional.statementTo");
    if (i.statementFrom > today) err("STATEMENT_FUTURE", "The statement period starts in the future", "institutional.statementFrom");
  }
  if (!/^\d{2}$/.test(i.patientStatus ?? "")) err("PATIENT_STATUS", "Enter the two-digit patient (discharge) status, e.g. 01 discharged home", "institutional.patientStatus");
  if (isInpatient(tob)) {
    if (!i.admissionDate) err("ADMIT_DATE", "Inpatient bills need the admission date", "institutional.admissionDate");
    else if (i.statementFrom && i.admissionDate > i.statementFrom) err("ADMIT_AFTER_STATEMENT", "The admission date is after the statement period starts", "institutional.admissionDate");
    if (!i.admissionType) err("ADMIT_TYPE", "Inpatient bills need the admission type (UB-04 FL14)", "institutional.admissionType");
    if (!i.admissionSource) err("ADMIT_SOURCE", "Inpatient bills need the point of origin (UB-04 FL15)", "institutional.admissionSource");
    if (!i.admittingDiagnosis) warn("ADMIT_DX", "Inpatient bills should carry the admitting diagnosis", "institutional.admittingDiagnosis");
  }
  if (!c.diagnoses.length) err("PRINCIPAL_DX", "Enter the principal diagnosis", "diagnoses");
  if (!isValidNpi(c.billingNpi)) err("BILLING_NPI", "The facility's NPI fails its check digit", "practice.npi");
  if (!isValidNpi(c.attendingNpi)) err("ATTENDING_NPI", "The attending provider's NPI fails its check digit", "provider.npi");
  if (!c.memberId.trim()) err("MEMBER_ID", "The patient's member ID is missing", "insurance.memberId");
  if (!c.payerId.trim()) err("PAYER_ID", "The payer has no clearinghouse payer ID", "payer.payerId");
  if (!c.lines.length) err("NO_LINES", "Add at least one revenue line");
  const facility = tob.slice(1, 3);
  for (const l of c.lines) {
    const rev = (l.revenueCode ?? "").padStart(4, "0");
    // Line revenue codes run 0100-0999, plus the 1000-3199 ranges (behavioral health, alternative therapies); 0001-0099 are not line codes.
    if (!/^\d{4}$/.test(rev) || Number(rev) < 100 || Number(rev) > 3199) err("REVENUE_CODE", `Line ${l.lineNumber}: "${l.revenueCode ?? ""}" is not a valid revenue code (0100-3199)`, `lines.${l.lineNumber}.revenueCode`);
    if (l.units < 1) err("UNITS", `Line ${l.lineNumber}: units must be at least 1`, `lines.${l.lineNumber}.units`);
    if (l.chargeCents <= 0) err("LINE_CHARGE", `Line ${l.lineNumber}: enter the charge`, `lines.${l.lineNumber}.charge`);
    if (OUTPATIENT_HCPCS.includes(facility) && !l.hcpcs && !NO_HCPCS_REVENUE.test(rev)) {
      warn("HCPCS_OUTPATIENT", `Line ${l.lineNumber}: outpatient revenue code ${rev} is usually billed with a HCPCS code`, `lines.${l.lineNumber}.hcpcs`);
    }
    if (l.hcpcs && !/^[0-9A-Z]{5}$/.test(l.hcpcs)) err("HCPCS_FORMAT", `Line ${l.lineNumber}: "${l.hcpcs}" is not a five-character HCPCS code`, `lines.${l.lineNumber}.hcpcs`);
  }
  if (isInpatient(tob) && !c.lines.some((l) => /^01\d\d$/.test((l.revenueCode ?? "").padStart(4, "0")) || /^02[0-1]\d$/.test((l.revenueCode ?? "").padStart(4, "0")))) {
    warn("ROOM_BOARD", "An inpatient bill usually has a room and board line (revenue code 01xx or 020x-021x)");
  }
  return out;
}
