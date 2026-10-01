/**
 * The HIPAA transaction standards the app sends and reads, in one place.
 *
 * Every X12 builder takes its implementation guide from here, so the version
 * in use is visible at a glance (Settings, Maintenance) and a new mandated
 * version is added beside the current one instead of being hunted through the
 * code. Adopting a new version is more than changing these strings: the
 * segments change too. docs/13-future-standards.md is the playbook.
 */
export const X12 = {
  "837P": { guide: "005010X222A1", name: "Professional claim" },
  "837I": { guide: "005010X223A2", name: "Institutional claim" },
  "837D": { guide: "005010X224A2", name: "Dental claim" },
  "835": { guide: "005010X221A1", name: "Remittance advice (ERA)" },
  "270/271": { guide: "005010X279A1", name: "Eligibility inquiry and response" },
  "276/277": { guide: "005010X212", name: "Claim status inquiry and response" },
  "277CA": { guide: "005010X214", name: "Claim acknowledgment" },
  "278": { guide: "005010X217", name: "Prior authorization request and response" },
  "999": { guide: "005010X231A1", name: "Implementation acknowledgment" },
} as const;

/** The X12 interchange version (ISA12) for every transaction above. */
export const ISA_VERSION = "00501";

/** Code systems in use, and what replaces each when the US adopts the next one. */
export const CODE_SYSTEMS = [
  { name: "ICD-10-CM", use: "Diagnoses", next: "ICD-11 (no US adoption date set; ICD-11 for US use would need its own clinical modification)" },
  { name: "ICD-10-PCS", use: "Inpatient procedures (facility claims)", next: "Updated every October 1 like ICD-10-CM" },
  { name: "CPT and HCPCS Level II", use: "Procedures, supplies and services", next: "Yearly CPT (January) and quarterly HCPCS updates; no replacement planned" },
] as const;
