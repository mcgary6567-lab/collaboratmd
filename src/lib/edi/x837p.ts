/**
 * Minimal ASC X12 005010X222A1 (837P) professional claim generator.
 *
 * This produces a syntactically valid single-claim transaction set suitable
 * for a clearinghouse sandbox. It covers the loops a small practice needs
 * (billing provider, subscriber, payer, claim, diagnoses, service lines).
 */

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
  };
  renderingProvider: { lastName: string; firstName: string; npi: string; taxonomy: string };
  payer: { name: string; payerId: string };
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
    dateOfService: string; // YYYY-MM-DD
    diagnoses: string[]; // ICD-10-CM without dots
    /** PWK: supporting documents sent separately, matched by control number. */
    attachments?: ClaimAttachmentRef[];
  };
  /**
   * Set on a secondary claim: the payer that adjudicated first and what it
   * decided, sent in loops 2320/2330 so the secondary pays only what is left.
   */
  otherPayer?: {
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
  const relCode: Record<string, string> = { self: "18", spouse: "01", child: "19", other: "G8" };

  s.push(["ISA", "00", pad("", 10), "00", pad("", 10), "ZZ", pad(input.senderId, 15), "ZZ", pad(input.receiverId, 15), yymmdd, hhmm, "^", "00501", icn, "0", "P", ":"]);
  s.push(["GS", "HC", input.senderId, input.receiverId, ccyymmdd, hhmm, icn.replace(/^0+/, "") || "1", "X", "005010X222A1"]);
  s.push(["ST", "837", "0001", "005010X222A1"]);
  s.push(["BHT", "0019", "00", input.controlNumber, ccyymmdd, hhmm, "CH"]);
  // 1000A submitter / 1000B receiver
  s.push(["NM1", "41", "2", input.billingProvider.name, "", "", "", "", "46", input.senderId]);
  s.push(["PER", "IC", input.billingProvider.name, "TE", "0000000000"]);
  s.push(["NM1", "40", "2", input.payer.name, "", "", "", "", "46", input.receiverId]);
  // 2000A billing provider
  s.push(["HL", "1", "", "20", "1"]);
  s.push(["PRV", "BI", "PXC", input.renderingProvider.taxonomy]);
  s.push(["NM1", "85", "2", input.billingProvider.name, "", "", "", "", "XX", input.billingProvider.npi]);
  s.push(["N3", input.billingProvider.address1]);
  s.push(["N4", input.billingProvider.city, input.billingProvider.state, input.billingProvider.zip.replace("-", "")]);
  s.push(["REF", "EI", input.billingProvider.taxId.replace("-", "")]);
  // 2000B subscriber
  s.push(["HL", "2", "1", "22", "0"]);
  s.push(["SBR", input.otherPayer ? "S" : "P", relCode[input.subscriber.relationship] ?? "18", input.subscriber.groupNumber ?? "", "", "", "", "", "", "CI"]);
  s.push(["NM1", "IL", "1", input.subscriber.lastName, input.subscriber.firstName, "", "", "", "MI", input.subscriber.memberId]);
  if (input.subscriber.address1) s.push(["N3", input.subscriber.address1]);
  if (input.subscriber.city) s.push(["N4", input.subscriber.city, input.subscriber.state ?? "", (input.subscriber.zip ?? "").replace("-", "")]);
  s.push(["DMG", "D8", d8(input.subscriber.dob), input.subscriber.sex]);
  s.push(["NM1", "PR", "2", input.payer.name, "", "", "", "", "PI", input.payer.payerId]);
  // 2300 claim
  s.push(["CLM", input.controlNumber, money(input.claim.totalCents), "", "", `${input.claim.placeOfService}:B:${input.claim.frequencyCode}`, "Y", "A", "Y", "Y"]);
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
  const hi = ["HI", ...input.claim.diagnoses.map((c, i) => `${i === 0 ? "ABK" : "ABF"}:${icd(c)}`)];
  s.push(hi);
  // 2310B rendering provider
  s.push(["NM1", "82", "1", input.renderingProvider.lastName, input.renderingProvider.firstName, "", "", "", "XX", input.renderingProvider.npi]);
  s.push(["PRV", "PE", "PXC", input.renderingProvider.taxonomy]);
  if (input.otherPayer) {
    const o = input.otherPayer;
    // 2320 other subscriber: the primary coverage, its adjudication, and the amount it paid.
    s.push(["SBR", "P", relCode[o.subscriber.relationship] ?? "18", o.subscriber.groupNumber ?? "", "", "", "", "", "", "CI"]);
    const byGroup = new Map<string, { reason: string; amountCents: number }[]>();
    for (const a of o.adjustments.filter((x) => x.amountCents !== 0)) byGroup.set(a.group, [...(byGroup.get(a.group) ?? []), a]);
    for (const [group, list] of byGroup) s.push(["CAS", group, ...list.slice(0, 6).flatMap((a) => [a.reason, money(a.amountCents), ""])]);
    s.push(["AMT", "D", money(o.paidCents)]);
    s.push(["OI", "", "", "Y", "", "", "Y"]);
    // 2330A other subscriber, 2330B other payer with its adjudication date.
    s.push(["NM1", "IL", "1", o.subscriber.lastName, o.subscriber.firstName, "", "", "", "MI", o.subscriber.memberId]);
    s.push(["NM1", "PR", "2", o.name, "", "", "", "", "PI", o.payerId]);
    s.push(["DTP", "573", "D8", d8(o.adjudicatedOn)]);
  }
  // 2400 service lines
  input.lines.forEach((line, idx) => {
    s.push(["LX", String(idx + 1)]);
    const sv1 = ["HC", line.cpt, ...line.modifiers.slice(0, 4)].join(":");
    s.push(["SV1", sv1, money(line.chargeCents), "UN", String(line.units), "", "", line.dxPointers.slice(0, 4).join(":")]);
    s.push(["DTP", "472", "D8", d8(line.dateOfService)]);
  });
  const segmentCount = s.length - 2 + 1; // ST through SE inclusive
  s.push(["SE", String(segmentCount), "0001"]);
  s.push(["GE", "1", icn.replace(/^0+/, "") || "1"]);
  s.push(["IEA", "1", icn]);

  return s.map((seg) => seg.join(ELEMENT).replace(/\*+$/, "")).join(SEGMENT) + "~";
}
