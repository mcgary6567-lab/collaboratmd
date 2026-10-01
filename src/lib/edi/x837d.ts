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
import { X12 } from "./standards";
import { contactPhone, envelope } from "./x12";
import { subscriberLoops, type Person, type Subscriber } from "./subscriber";
import { otherPayerLoops, pwk, serviceFacilityLoop, type ClaimAttachmentRef, type OtherPayer, type ServiceFacility } from "./x837p";

export interface Edi837DInput {
  controlNumber: string;
  interchangeControl: string;
  senderId: string;
  receiverId: string;
  now: Date;
  billingProvider: { name: string; npi: string; taxId: string; address1: string; city: string; state: string; zip: string; taxonomy: string; phone?: string | null; individual?: { lastName: string; firstName: string } | null };
  rendering: { lastName: string; firstName: string; npi: string; taxonomy: string };
  payer: { name: string; payerId: string; type: string };
  /** The insured person; with `patient`, the patient when that is someone else (lib/edi/subscriber.ts). */
  subscriber: Subscriber;
  patient?: Person;
  claim: {
    totalCents: number;
    placeOfService: string;
    frequencyCode: string;
    originalPayerClaimNumber?: string | null;
    authorizationNumber?: string | null;
    diagnoses: string[];
    attachments?: ClaimAttachmentRef[];
  };
  /** Set on a secondary claim: the primary payer's adjudication (loops 2320/2330). */
  otherPayer?: OtherPayer;
  serviceFacility?: ServiceFacility | null;
  lines: { cdt: string; chargeCents: number; units: number; dateOfService: string; tooth?: string | null; surfaces?: string | null; oralCavity?: string | null }[];
}

const VERSION = X12["837D"].guide;
const d8 = (iso: string) => iso.replace(/-/g, "");
const money = (c: number) => (c / 100).toFixed(2);
const icd = (c: string) => c.replace(".", "").toUpperCase();
const filingIndicator = (type: string) => (type === "medicaid" ? "MC" : "CI");

export function buildEdi837D(input: Edi837DInput): string {
  const hhmm = input.now.toISOString().slice(11, 16).replace(":", "");
  const body: string[][] = [
    ["BHT", "0019", "00", input.controlNumber, d8(input.now.toISOString().slice(0, 10)), hhmm, "CH"],
    ["NM1", "41", "2", input.billingProvider.name, "", "", "", "", "46", input.senderId],
    ["PER", "IC", input.billingProvider.name, "TE", contactPhone(input.billingProvider.phone)],
    ["NM1", "40", "2", input.payer.name, "", "", "", "", "46", input.receiverId],
    // 2000A billing provider
    ["HL", "1", "", "20", "1"],
    ["PRV", "BI", "PXC", input.billingProvider.taxonomy],
    input.billingProvider.individual ? ["NM1", "85", "1", input.billingProvider.individual.lastName, input.billingProvider.individual.firstName, "", "", "", "XX", input.billingProvider.npi] : ["NM1", "85", "2", input.billingProvider.name, "", "", "", "", "XX", input.billingProvider.npi],
    ["N3", input.billingProvider.address1],
    ["N4", input.billingProvider.city, input.billingProvider.state, input.billingProvider.zip.replace("-", "")],
    ["REF", "EI", input.billingProvider.taxId.replace("-", "")],
    // 2000B subscriber and payer, then 2000C patient when the patient is a dependent (lib/edi/subscriber.ts)
    ...subscriberLoops({
      sequence: input.otherPayer ? "S" : "P",
      subscriber: input.subscriber,
      patient: input.patient ?? input.subscriber,
      filing: filingIndicator(input.payer.type),
      payer: ["NM1", "PR", "2", input.payer.name, "", "", "", "", "PI", input.payer.payerId],
    }),
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
  if (input.serviceFacility) body.push(...serviceFacilityLoop(input.serviceFacility));
  if (input.otherPayer) body.push(...otherPayerLoops(input.otherPayer, filingIndicator(input.otherPayer.type ?? "")));
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

