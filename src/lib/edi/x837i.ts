/**
 * ASC X12 005010X223A2 (837I) institutional claim: what hospitals, surgery
 * centers, skilled nursing and other facilities bill on (the UB-04's
 * electronic form).
 *
 * Differences from the professional 837P: the type of bill in CLM05, a
 * statement period (DTP*434), admission details for inpatient stays
 * (DTP*435, CL1), principal and admitting diagnoses, an attending provider
 * (NM1*71), and service lines that carry a revenue code (SV2).
 */
import { envelope } from "./x12";
import { pwk, type ClaimAttachmentRef } from "./x837p";

export interface Institutional {
  /** Four digits, e.g. 0131 hospital outpatient, 0111 inpatient admit through discharge. */
  typeOfBill: string;
  statementFrom: string;
  statementTo: string;
  admissionDate?: string | null;
  /** HHMM, 24-hour. */
  admissionHour?: string | null;
  /** UB-04 FL14: 1 emergency, 2 urgent, 3 elective, 4 newborn, 5 trauma, 9 unknown. */
  admissionType?: string | null;
  /** UB-04 FL15, e.g. 1 non-health-care point of origin, 2 clinic, 4 transfer from a hospital, 7 emergency room. */
  admissionSource?: string | null;
  /** UB-04 FL17 discharge status, e.g. 01 home, 03 skilled nursing, 20 expired, 30 still a patient. */
  patientStatus: string;
  admittingDiagnosis?: string | null;
}

export interface Edi837IInput {
  controlNumber: string;
  interchangeControl: string;
  senderId: string;
  receiverId: string;
  now: Date;
  billingProvider: { name: string; npi: string; taxId: string; address1: string; city: string; state: string; zip: string };
  attending: { lastName: string; firstName: string; npi: string; taxonomy: string };
  payer: { name: string; payerId: string; type: string };
  subscriber: { lastName: string; firstName: string; memberId: string; groupNumber?: string | null; dob: string; sex: string; address1?: string | null; city?: string | null; state?: string | null; zip?: string | null; relationship: string };
  claim: {
    totalCents: number;
    frequencyCode: string;
    originalPayerClaimNumber?: string | null;
    authorizationNumber?: string | null;
    diagnoses: string[];
    institutional: Institutional;
    attachments?: ClaimAttachmentRef[];
  };
  lines: { revenueCode: string; hcpcs?: string | null; modifiers?: string[]; chargeCents: number; units: number; dateOfService: string }[];
}

const VERSION = "005010X223A2";
const d8 = (iso: string) => iso.replace(/-/g, "");
const money = (c: number) => (c / 100).toFixed(2);
const icd = (c: string) => c.replace(".", "").toUpperCase();

/** Inpatient bill types need admission details: hospital inpatient, swing bed and SNF inpatient. */
export const INPATIENT_FACILITY_TYPES = ["11", "18", "21", "41", "65", "66", "86"];
export const isInpatient = (tob: string) => INPATIENT_FACILITY_TYPES.includes(tob.padStart(4, "0").slice(1, 3));

/** SBR09 claim filing indicator from the payer's type. */
const filingIndicator = (type: string) => (type === "medicare" ? "MA" : type === "medicaid" ? "MC" : "CI");

export function buildEdi837I(input: Edi837IInput): string {
  const inst = input.claim.institutional;
  const tob = inst.typeOfBill.padStart(4, "0");
  const relCode: Record<string, string> = { self: "18", spouse: "01", child: "19", other: "G8" };
  const hhmm = input.now.toISOString().slice(11, 16).replace(":", "");
  const body: string[][] = [
    ["BHT", "0019", "00", input.controlNumber, d8(input.now.toISOString().slice(0, 10)), hhmm, "CH"],
    ["NM1", "41", "2", input.billingProvider.name, "", "", "", "", "46", input.senderId],
    ["PER", "IC", input.billingProvider.name, "TE", "0000000000"],
    ["NM1", "40", "2", input.payer.name, "", "", "", "", "46", input.receiverId],
    // 2000A billing provider (the facility)
    ["HL", "1", "", "20", "1"],
    ["NM1", "85", "2", input.billingProvider.name, "", "", "", "", "XX", input.billingProvider.npi],
    ["N3", input.billingProvider.address1],
    ["N4", input.billingProvider.city, input.billingProvider.state, input.billingProvider.zip.replace("-", "")],
    ["REF", "EI", input.billingProvider.taxId.replace("-", "")],
    // 2000B subscriber and payer
    ["HL", "2", "1", "22", "0"],
    ["SBR", "P", relCode[input.subscriber.relationship] ?? "18", input.subscriber.groupNumber ?? "", "", "", "", "", "", filingIndicator(input.payer.type)],
    ["NM1", "IL", "1", input.subscriber.lastName, input.subscriber.firstName, "", "", "", "MI", input.subscriber.memberId],
    ...(input.subscriber.address1 ? [["N3", input.subscriber.address1]] : []),
    ...(input.subscriber.city ? [["N4", input.subscriber.city, input.subscriber.state ?? "", (input.subscriber.zip ?? "").replace("-", "")]] : []),
    ["DMG", "D8", d8(input.subscriber.dob), input.subscriber.sex],
    ["NM1", "PR", "2", input.payer.name, "", "", "", "", "PI", input.payer.payerId],
    // 2300 claim: CLM05 is facility type (TOB digits 2-3), qualifier A, frequency (TOB digit 4).
    ["CLM", input.controlNumber, money(input.claim.totalCents), "", "", `${tob.slice(1, 3)}:A:${input.claim.frequencyCode === "1" ? tob.slice(3) : input.claim.frequencyCode}`, "", "A", "Y", "Y"],
    ...(inst.admissionDate ? [["DTP", "435", "DT", `${d8(inst.admissionDate)}${(inst.admissionHour ?? "0000").padStart(4, "0")}`]] : []),
    ["DTP", "434", "RD8", `${d8(inst.statementFrom)}-${d8(inst.statementTo)}`],
    ["CL1", inst.admissionType ?? "", inst.admissionSource ?? "", inst.patientStatus],
    ...(input.claim.attachments ?? []).map(pwk),
  ];
  if (input.claim.frequencyCode === "7" || input.claim.frequencyCode === "8") {
    if (!input.claim.originalPayerClaimNumber) throw new Error(`Frequency ${input.claim.frequencyCode} claim ${input.controlNumber} needs the payer's original claim number (REF*F8)`);
    body.push(["REF", "F8", input.claim.originalPayerClaimNumber]);
  }
  if (input.claim.authorizationNumber) body.push(["REF", "G1", input.claim.authorizationNumber]);
  body.push(["HI", `ABK:${icd(input.claim.diagnoses[0])}`]);
  if (inst.admittingDiagnosis) body.push(["HI", `ABJ:${icd(inst.admittingDiagnosis)}`]);
  if (input.claim.diagnoses.length > 1) body.push(["HI", ...input.claim.diagnoses.slice(1, 25).map((c) => `ABF:${icd(c)}`)]);
  // 2310A attending provider
  body.push(["NM1", "71", "1", input.attending.lastName, input.attending.firstName, "", "", "", "XX", input.attending.npi]);
  body.push(["PRV", "AT", "PXC", input.attending.taxonomy]);
  // 2400 service lines
  input.lines.forEach((l, i) => {
    body.push(["LX", String(i + 1)]);
    body.push(["SV2", l.revenueCode.padStart(4, "0"), l.hcpcs ? ["HC", l.hcpcs, ...(l.modifiers ?? []).slice(0, 4)].join(":") : "", money(l.chargeCents), "UN", String(l.units)]);
    body.push(["DTP", "472", "D8", d8(l.dateOfService)]);
  });
  return envelope({ senderId: input.senderId, receiverId: input.receiverId, functionalId: "HC", transactionSet: "837", version: VERSION, control: input.interchangeControl, now: input.now, body });
}
