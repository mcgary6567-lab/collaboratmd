/**
 * Common outpatient lab tests: what is ordered (CPT and the lab's panel) and
 * what comes back (LOINC-coded components with units and adult reference
 * ranges). Reference ranges vary by lab and patient; these are typical adult
 * values used to flag results when the lab does not send its own.
 */

export interface LabComponent {
  loinc: string;
  name: string;
  units: string;
  low: number | null;
  high: number | null;
  /** Typical value and spread, for the demo result simulator only. */
  typical: [number, number];
  decimals: number;
}

export interface LabTest {
  code: string; // the lab's orderable code
  cpt: string;
  name: string;
  specimen: string;
  components: LabComponent[];
}

const c = (loinc: string, name: string, units: string, low: number | null, high: number | null, typical: [number, number], decimals = 0): LabComponent => ({ loinc, name, units, low, high, typical, decimals });

export const LAB_TESTS: LabTest[] = [
  {
    code: "CMP", cpt: "80053", name: "Comprehensive metabolic panel", specimen: "Serum",
    components: [
      c("2345-7", "Glucose", "mg/dL", 70, 99, [98, 22]),
      c("3094-0", "BUN", "mg/dL", 7, 20, [15, 5]),
      c("2160-0", "Creatinine", "mg/dL", 0.6, 1.3, [0.95, 0.25], 2),
      c("2951-2", "Sodium", "mmol/L", 135, 145, [140, 2.5]),
      c("2823-3", "Potassium", "mmol/L", 3.5, 5.1, [4.2, 0.4], 1),
      c("2075-0", "Chloride", "mmol/L", 98, 107, [102, 2.5]),
      c("2028-9", "Carbon dioxide", "mmol/L", 22, 29, [25, 2]),
      c("17861-6", "Calcium", "mg/dL", 8.6, 10.3, [9.5, 0.4], 1),
      c("2885-2", "Protein, total", "g/dL", 6.0, 8.3, [7.1, 0.5], 1),
      c("1751-7", "Albumin", "g/dL", 3.5, 5.0, [4.3, 0.3], 1),
      c("1975-2", "Bilirubin, total", "mg/dL", 0.1, 1.2, [0.6, 0.25], 1),
      c("6768-6", "Alkaline phosphatase", "U/L", 44, 147, [80, 25]),
      c("1920-8", "AST", "U/L", 10, 40, [24, 9]),
      c("1742-6", "ALT", "U/L", 7, 56, [26, 12]),
    ],
  },
  {
    code: "CBC", cpt: "85025", name: "CBC with differential", specimen: "Whole blood",
    components: [
      c("6690-2", "WBC", "10*3/uL", 4.5, 11.0, [7.2, 1.8], 1),
      c("789-8", "RBC", "10*6/uL", 4.2, 5.9, [4.8, 0.4], 2),
      c("718-7", "Hemoglobin", "g/dL", 12.0, 17.5, [14.2, 1.3], 1),
      c("4544-3", "Hematocrit", "%", 36, 51, [42, 3.5], 1),
      c("777-3", "Platelets", "10*3/uL", 150, 400, [250, 55]),
    ],
  },
  { code: "A1C", cpt: "83036", name: "Hemoglobin A1c", specimen: "Whole blood", components: [c("4548-4", "Hemoglobin A1c", "%", 4.0, 5.6, [6.1, 1.1], 1)] },
  {
    code: "LIPID", cpt: "80061", name: "Lipid panel", specimen: "Serum",
    components: [
      c("2093-3", "Cholesterol, total", "mg/dL", null, 200, [195, 35]),
      c("2571-8", "Triglycerides", "mg/dL", null, 150, [140, 55]),
      c("2085-9", "HDL cholesterol", "mg/dL", 40, null, [52, 12]),
      c("13457-7", "LDL cholesterol, calculated", "mg/dL", null, 100, [112, 30]),
    ],
  },
  { code: "TSH", cpt: "84443", name: "TSH", specimen: "Serum", components: [c("3016-3", "TSH", "mIU/L", 0.4, 4.0, [2.1, 1.1], 2)] },
  { code: "VITD", cpt: "82306", name: "Vitamin D, 25-hydroxy", specimen: "Serum", components: [c("1989-3", "Vitamin D, 25-OH", "ng/mL", 30, 100, [31, 11])] },
  { code: "PSA", cpt: "84153", name: "PSA, total", specimen: "Serum", components: [c("2857-1", "PSA", "ng/mL", null, 4.0, [1.6, 1.2], 2)] },
];

export const testByCode = (code: string) => LAB_TESTS.find((t) => t.code === code);

/** Labs a practice can order from. Electronic ordering needs an account and an interface with each lab. */
export const LABS = [
  { code: "QUEST", name: "Quest Diagnostics" },
  { code: "LABCORP", name: "Labcorp" },
  { code: "BIOREF", name: "BioReference Health" },
  { code: "INOFFICE", name: "In-office lab" },
] as const;

export type LabCode = (typeof LABS)[number]["code"];

/** HL7 table 0078 abnormal flags from a value and its range. */
export function abnormalFlag(value: number, low: number | null, high: number | null): "" | "L" | "H" | "LL" | "HH" {
  if (low !== null && value < low) return value < low * 0.7 ? "LL" : "L";
  if (high !== null && value > high) return value > high * 1.5 ? "HH" : "H";
  return "";
}

export function rangeText(low: number | null, high: number | null): string {
  if (low !== null && high !== null) return `${low}-${high}`;
  if (low !== null) return `>=${low}`;
  if (high !== null) return `<=${high}`;
  return "";
}
