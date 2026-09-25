/**
 * ASC X12 005010X224A2 (837D) dental claim: the ADA claim form's electronic
 * equivalent.
 *
 * Differences from the professional 837P: procedures are CDT codes (D0000 to
 * D9999) in SV3 with the AD qualifier; each line can name the tooth (TOO,
 * JP = ADA Universal National Tooth Designation System) with the surfaces
 * treated, or the area of the oral cavity (SV304); the service date is on
 * each line; and diagnosis codes are optional.
 *
 * Built from the implementation guide's structure and checked by this
 * project's structural tests, not certified by a clearinghouse. Send test
 * claims before relying on it.
 */
import { envelope } from "./x12";
import { pwk, type ClaimAttachmentRef } from "./x837p";

export interface Edi837DInput {
  controlNumber: string;
  interchangeControl: string;
  senderId: string;
  receiverId: string;
  now: Date;
  billingProvider: { name: string; npi: string; taxId: string; address1: string; city: string; state: string; zip: string; taxonomy: string };
  rendering: { lastName: string; firstName: string; npi: string; taxonomy: string };
  payer: { name: string; payerId: string; type: string };
  subscriber: { lastName: string; firstName: string; memberId: string; groupNumber?: string | null; dob: string; sex: string; address1?: string | null; city?: string | null; state?: string | null; zip?: string | null; relationship: string };
  claim: {
    totalCents: number;
    placeOfService: string;
    frequencyCode: string;
    originalPayerClaimNumber?: string | null;
    authorizationNumber?: string | null;
    diagnoses: string[];
    attachments?: ClaimAttachmentRef[];
  };
  lines: { cdt: string; chargeCents: number; units: number; dateOfService: string; tooth?: string | null; surfaces?: string | null; oralCavity?: string | null }[];
}

const VERSION = "005010X224A2";
const d8 = (iso: string) => iso.replace(/-/g, "");
const money = (c: number) => (c / 100).toFixed(2);
const icd = (c: string) => c.replace(".", "").toUpperCase();
const filingIndicator = (type: string) => (type === "medicaid" ? "MC" : "CI");

export function buildEdi837D(input: Edi837DInput): string {
  const relCode: Record<string, string> = { self: "18", spouse: "01", child: "19", other: "G8" };
  const hhmm = input.now.toISOString().slice(11, 16).replace(":", "");
  const body: string[][] = [
    ["BHT", "0019", "00", input.controlNumber, d8(input.now.toISOString().slice(0, 10)), hhmm, "CH"],
    ["NM1", "41", "2", input.billingProvider.name, "", "", "", "", "46", input.senderId],
    ["PER", "IC", input.billingProvider.name, "TE", "0000000000"],
    ["NM1", "40", "2", input.payer.name, "", "", "", "", "46", input.receiverId],
    // 2000A billing provider
    ["HL", "1", "", "20", "1"],
    ["PRV", "BI", "PXC", input.billingProvider.taxonomy],
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
    // 2300 claim: CLM05 place of service, qualifier B, frequency.
    ["CLM", input.controlNumber, money(input.claim.totalCents), "", "", `${input.claim.placeOfService}:B:${input.claim.frequencyCode}`, "Y", "A", "Y", "Y"],
    ...(input.claim.attachments ?? []).map(pwk),
  ];
  if (input.claim.frequencyCode === "7" || input.claim.frequencyCode === "8") {
    if (!input.claim.originalPayerClaimNumber) throw new Error(`Frequency ${input.claim.frequencyCode} claim ${input.controlNumber} needs the payer's original claim number (REF*F8)`);
    body.push(["REF", "F8", input.claim.originalPayerClaimNumber]);
  }
  if (input.claim.authorizationNumber) body.push(["REF", "G1", input.claim.authorizationNumber]);
  if (input.claim.diagnoses.length) body.push(["HI", ...input.claim.diagnoses.slice(0, 4).map((c, i) => `${i === 0 ? "ABK" : "ABF"}:${icd(c)}`)]);
  // 2310B rendering dentist
  body.push(["NM1", "82", "1", input.rendering.lastName, input.rendering.firstName, "", "", "", "XX", input.rendering.npi]);
  body.push(["PRV", "PE", "PXC", input.rendering.taxonomy]);
  // 2400 service lines
  input.lines.forEach((l, i) => {
    body.push(["LX", String(i + 1)]);
    const cavity = (l.oralCavity ?? "").split(/[\s,:]+/).filter(Boolean).slice(0, 5).join(":");
    body.push(["SV3", `AD:${l.cdt.toUpperCase()}`, money(l.chargeCents), "", cavity, "", String(l.units)]);
    if (l.tooth) body.push(["TOO", "JP", l.tooth.toUpperCase(), ...(l.surfaces ? [l.surfaces.toUpperCase().split("").join(":")] : [])]);
    body.push(["DTP", "472", "D8", d8(l.dateOfService)]);
  });
  return envelope({ senderId: input.senderId, receiverId: input.receiverId, functionalId: "HC", transactionSet: "837", version: VERSION, control: input.interchangeControl, now: input.now, body });
}

