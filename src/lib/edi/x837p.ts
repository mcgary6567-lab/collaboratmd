/**
 * Minimal ASC X12 005010X222A1 (837P) professional claim generator.
 *
 * This produces a syntactically valid single-claim transaction set suitable
 * for a clearinghouse sandbox. It covers the loops a small practice needs
 * (billing provider, subscriber, payer, claim, diagnoses, service lines).
 */
import { isAnesthesiaCode } from "@/lib/time-units";
import { contactPhone } from "./x12";
import { REL_CODE, subscriberLoops, type Person } from "./subscriber";

/**
 * SBR09, the claim filing indicator, on a professional claim: Medicare Part B,
 * Medicaid, or commercial. Medicare contractors reject a claim filed as CI.
 */
export const professionalFiling = (type?: string | null) => (type === "medicare" ? "MB" : type === "medicaid" ? "MC" : type === "workers_comp" ? "WC" : type === "auto" ? "AM" : "CI");

/** What caused the condition, for CLM11: employment (EM), an auto accident (AA, with its state) or another accident (OA). */
export type AccidentInfo = { employment?: boolean; auto?: boolean; autoState?: string | null; other?: boolean; date?: string | null };

/** CLM11 composite, or null when the condition is not related to work or an accident. */
export function relatedCauses(a?: AccidentInfo | null) {
  if (!a) return null;
  const codes = [a.employment && "EM", a.auto && "AA", a.other && "OA"].filter(Boolean) as string[];
  if (!codes.length) return null;
  return [codes[0], codes[1] ?? "", codes[2] ?? "", a.auto ? (a.autoState ?? "").toUpperCase() : ""].join(":").replace(/:+$/, "");
}

/** A supporting document for a claim (see server/attachments.ts). */
export type ClaimAttachmentRef = { reportType: string; transmission: string; controlNumber: string };

/**
 * PWK (loop 2300): tells the payer a document supports the claim and how it
 * is coming. PWK01 is the report type, PWK02 the transmission (FX fax, BM
 * mail, EL electronic, AA available on request), PWK05-06 the attachment
 * control number the payer matches the document by (not sent for AA).
 */
export function pwk(a: ClaimAttachmentRef): string[] {
  return a.transmission === "AA" ? ["PWK", a.reportType, "AA"] : ["PWK", a.reportType, a.transmission, "", "", "AC", a.controlNumber];
}

export type OtherPayer = NonNullable<Edi837Input["otherPayer"]>;

/** Where the service was performed, when it is not the billing provider's address (loop 2310C). */
export type ServiceFacility = { name: string; npi?: string | null; address1: string; city: string; state: string; zip: string };

export function serviceFacilityLoop(f: ServiceFacility): string[][] {
  return [
    f.npi ? ["NM1", "77", "2", f.name, "", "", "", "", "XX", f.npi] : ["NM1", "77", "2", f.name],
    ["N3", f.address1],
    ["N4", f.city, f.state, f.zip.replace("-", "")],
  ];
}

/**
 * Loops 2320/2330 of any 837 (P, I or D) on a secondary claim: the primary
 * coverage, its claim-level adjustments (CAS), what it paid (AMT*D), and the
 * primary payer with its adjudication date, so the secondary pays only what
 * is left.
 */
export function otherPayerLoops(o: OtherPayer, filing = "CI"): string[][] {
  // 2320 SBR02 is the patient's relationship to the other plan's subscriber (18 when it is themselves).
  const out: string[][] = [["SBR", "P", REL_CODE[o.subscriber.relationship] ?? "18", o.subscriber.groupNumber ?? "", "", "", "", "", "", filing]];
  const byGroup = new Map<string, { reason: string; amountCents: number }[]>();
  for (const a of o.adjustments.filter((x) => x.amountCents !== 0)) byGroup.set(a.group, [...(byGroup.get(a.group) ?? []), a]);
  for (const [group, list] of byGroup) out.push(["CAS", group, ...list.slice(0, 6).flatMap((a) => [a.reason, money(a.amountCents), ""])]);
  out.push(["AMT", "D", money(o.paidCents)]);
  out.push(["OI", "", "", "Y", "", "", "Y"]);
  out.push(["NM1", "IL", "1", o.subscriber.lastName, o.subscriber.firstName, "", "", "", "MI", o.subscriber.memberId]);
  out.push(["NM1", "PR", "2", o.name, "", "", "", "", "PI", o.payerId]);
  out.push(["DTP", "573", "D8", d8(o.adjudicatedOn)]);
  return out;
}

export interface Edi837Input {
  controlNumber: string; // patient control number (CLM01)
  interchangeControl: string; // 9 digits
  senderId: string;
  receiverId: string;
  now: Date;
  billingProvider: {
    name: string;
    npi: string;
    taxId: string;
    address1: string;
    city: string;
    state: string;
    zip: string;
    /** Submitter contact number (PER in loop 1000A). */
    phone?: string | null;
    /** A solo provider billing under their Type 1 NPI: the billing provider is a person (NM1*85*1). */
    individual?: { lastName: string; firstName: string } | null;
  };
  renderingProvider: { lastName: string; firstName: string; npi: string; taxonomy: string };
  /** The referring provider, sent in loop 2310A when present. */
  referringProvider?: { lastName: string; firstName: string; npi: string } | null;
  /** The supervising provider, sent in loop 2310D (NM1*DQ) when present. */
  supervisingProvider?: { lastName: string; firstName: string; npi: string } | null;
  serviceFacility?: ServiceFacility | null;
  /** `type` (medicare, medicaid, commercial...) sets the claim filing indicator, SBR09. */
  payer: { name: string; payerId: string; type?: string | null };
  /** The patient, when not the subscriber (relationship not "self"): sent in loop 2000C. */
  patient?: Person;
  /** The insured person: the patient, or (relationship not "self") whoever holds the plan. */
  subscriber: {
    lastName: string;
    firstName: string;
    memberId: string;
    groupNumber?: string | null;
    dob: string; // YYYY-MM-DD
    sex: string; // M | F | U
    address1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    relationship: string; // self | spouse | child | other
  };
  claim: {
    totalCents: number;
    placeOfService: string;
    frequencyCode: string;
    /** REF*F8: required when frequencyCode is 7 (replacement) or 8 (void). */
    originalPayerClaimNumber?: string | null;
    /** REF*G1: prior authorization number, when one covers the claim. */
    authorizationNumber?: string | null;
    /** CLIA certificate number, for claims with laboratory tests (REF*X4). */
    cliaNumber?: string | null;
    dateOfService: string; // YYYY-MM-DD
    diagnoses: string[]; // ICD-10-CM without dots
    /** PWK: supporting documents sent separately, matched by control number. */
    attachments?: ClaimAttachmentRef[];
    /** Related to employment or an accident: CLM11 and, for an accident, its date (DTP*439). */
    accident?: AccidentInfo | null;
  };
  /** The workers' comp or auto insurer's claim number (2010BA REF*Y4). */
  propertyClaimNumber?: string | null;
  /** Medicare as the secondary payer: the MSP type (SBR05). */
  mspType?: string | null;
  /**
   * Set on a secondary claim: the payer that adjudicated first and what it
   * decided, sent in loops 2320/2330 so the secondary pays only what is left.
   */
  otherPayer?: {
    /** The primary payer's type, for its filing indicator in loop 2320. */
    type?: string | null;
    name: string;
    payerId: string;
    subscriber: { lastName: string; firstName: string; memberId: string; groupNumber?: string | null; relationship: string };
    paidCents: number;
    /** Date the primary adjudicated (remittance date), YYYY-MM-DD. */
    adjudicatedOn: string;
    /** Claim-level adjustments from the primary's remittance, e.g. CO-45, PR-2. */
    adjustments: { group: string; reason: string; amountCents: number }[];
  };
  lines: {
    cpt: string;
    modifiers: string[];
    chargeCents: number;
    units: number;
    dxPointers: number[];
    dateOfService: string;
    /** Anesthesia is reported in minutes (SV103 MJ) instead of units. */
    minutes?: number | null;
    /** A drug line's 11-digit NDC, unit and quantity (2410 LIN/CTP). */
    ndc?: string | null;
    ndcUnit?: string | null;
    ndcQuantity?: number | null;
  }[];
}

const ELEMENT = "*";
const SEGMENT = "~\n";

function d8(date: string): string {
  return date.replace(/-/g, "");
}
function money(cents: number): string {
  if (!Number.isFinite(cents)) throw new Error(`Cannot serialize non-numeric monetary amount: ${cents}`);
  return (cents / 100).toFixed(2);
}
function pad(v: string | number, len: number, char = " "): string {
  return String(v).padEnd(len, char).slice(0, len);
}
function icd(code: string): string {
  return code.replace(".", "").toUpperCase();
}

export function buildEdi837P(input: Edi837Input): string {
  const s: string[][] = [];
  const now = input.now;
  const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, "");
  const ccyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const hhmm = now.toISOString().slice(11, 16).replace(":", "");
  const icn = input.interchangeControl.padStart(9, "0").slice(-9);


  s.push(["ISA", "00", pad("", 10), "00", pad("", 10), "ZZ", pad(input.senderId, 15), "ZZ", pad(input.receiverId, 15), yymmdd, hhmm, "^", "00501", icn, "0", "P", ":"]);
  s.push(["GS", "HC", input.senderId, input.receiverId, ccyymmdd, hhmm, icn.replace(/^0+/, "") || "1", "X", "005010X222A1"]);
  s.push(["ST", "837", "0001", "005010X222A1"]);
  s.push(["BHT", "0019", "00", input.controlNumber, ccyymmdd, hhmm, "CH"]);
  // 1000A submitter / 1000B receiver
  s.push(["NM1", "41", "2", input.billingProvider.name, "", "", "", "", "46", input.senderId]);
  s.push(["PER", "IC", input.billingProvider.name, "TE", contactPhone(input.billingProvider.phone)]);
  s.push(["NM1", "40", "2", input.payer.name, "", "", "", "", "46", input.receiverId]);
  // 2000A billing provider
  s.push(["HL", "1", "", "20", "1"]);
  s.push(["PRV", "BI", "PXC", input.renderingProvider.taxonomy]);
  const bp = input.billingProvider;
  s.push(bp.individual ? ["NM1", "85", "1", bp.individual.lastName, bp.individual.firstName, "", "", "", "XX", bp.npi] : ["NM1", "85", "2", bp.name, "", "", "", "", "XX", bp.npi]);
  s.push(["N3", input.billingProvider.address1]);
  s.push(["N4", input.billingProvider.city, input.billingProvider.state, input.billingProvider.zip.replace("-", "")]);
  s.push(["REF", "EI", input.billingProvider.taxId.replace("-", "")]);
  // 2000B subscriber and payer, then 2000C patient when the patient is a dependent (lib/edi/subscriber.ts)
  s.push(...subscriberLoops({
    sequence: input.otherPayer ? "S" : "P",
    subscriber: input.subscriber,
    patient: input.patient ?? input.subscriber,
    filing: professionalFiling(input.payer.type),
    payer: ["NM1", "PR", "2", input.payer.name, "", "", "", "", "PI", input.payer.payerId],
    propertyClaimNumber: input.propertyClaimNumber,
    insuranceType: input.mspType,
  }));
  // 2300 claim
  const causes = relatedCauses(input.claim.accident);
  s.push(["CLM", input.controlNumber, money(input.claim.totalCents), "", "", `${input.claim.placeOfService}:B:${input.claim.frequencyCode}`, "Y", "A", "Y", "Y", ...(causes ? ["", causes] : [])]);
  if (input.claim.accident?.date && (input.claim.accident.auto || input.claim.accident.other || input.claim.accident.employment)) s.push(["DTP", "439", "D8", d8(input.claim.accident.date)]);
  for (const a of input.claim.attachments ?? []) s.push(pwk(a));
  // 2300 REF segments precede HI. A replacement or void without the payer's
  // original claim number is rejected, so refuse to build one.
  if (input.claim.frequencyCode === "7" || input.claim.frequencyCode === "8") {
    if (!input.claim.originalPayerClaimNumber) {
      throw new Error(`Frequency ${input.claim.frequencyCode} claim ${input.controlNumber} needs the payer's original claim number (REF*F8)`);
    }
    s.push(["REF", "F8", input.claim.originalPayerClaimNumber]);
  }
  if (input.claim.authorizationNumber) s.push(["REF", "G1", input.claim.authorizationNumber]);
  if (input.claim.cliaNumber) s.push(["REF", "X4", input.claim.cliaNumber]);
  const hi = ["HI", ...input.claim.diagnoses.map((c, i) => `${i === 0 ? "ABK" : "ABF"}:${icd(c)}`)];
  s.push(hi);
  // 2310A referring provider
  if (input.referringProvider) s.push(["NM1", "DN", "1", input.referringProvider.lastName, input.referringProvider.firstName, "", "", "", "XX", input.referringProvider.npi]);
  // 2310B rendering provider
  s.push(["NM1", "82", "1", input.renderingProvider.lastName, input.renderingProvider.firstName, "", "", "", "XX", input.renderingProvider.npi]);
  s.push(["PRV", "PE", "PXC", input.renderingProvider.taxonomy]);
  if (input.serviceFacility) s.push(...serviceFacilityLoop(input.serviceFacility));
  // 2310D supervising provider
  if (input.supervisingProvider) s.push(["NM1", "DQ", "1", input.supervisingProvider.lastName, input.supervisingProvider.firstName, "", "", "", "XX", input.supervisingProvider.npi]);
  if (input.otherPayer) s.push(...otherPayerLoops(input.otherPayer, professionalFiling(input.otherPayer.type)));
  // 2400 service lines
  input.lines.forEach((line, idx) => {
    s.push(["LX", String(idx + 1)]);
    const sv1 = ["HC", line.cpt, ...line.modifiers.slice(0, 4)].join(":");
    const inMinutes = isAnesthesiaCode(line.cpt) && line.minutes;
    s.push(["SV1", sv1, money(line.chargeCents), inMinutes ? "MJ" : "UN", inMinutes ? String(line.minutes) : String(line.units), "", "", line.dxPointers.slice(0, 4).join(":")]);
    s.push(["DTP", "472", "D8", d8(line.dateOfService)]);
    // 2410 drug identification: the NDC, then the quantity of drug in its unit.
    if (line.ndc) {
      s.push(["LIN", "", "N4", line.ndc]);
      s.push(["CTP", "", "", "", String(line.ndcQuantity ?? 1), line.ndcUnit ?? "UN"]);
    }
  });
  const segmentCount = s.length - 2 + 1; // ST through SE inclusive
  s.push(["SE", String(segmentCount), "0001"]);
  s.push(["GE", "1", icn.replace(/^0+/, "") || "1"]);
  s.push(["IEA", "1", icn]);

  return s.map((seg) => seg.join(ELEMENT).replace(/\*+$/, "")).join(SEGMENT) + "~";
}
