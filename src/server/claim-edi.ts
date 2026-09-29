import { isLabCode } from "@/lib/codes/lab";
import { buildEdi837P, type ClaimAttachmentRef, type OtherPayer, type ServiceFacility } from "@/lib/edi/x837p";
import { buildEdi837I } from "@/lib/edi/x837i";
import { buildEdi837D } from "@/lib/edi/x837d";
import type { ClaimBundle } from "./claims";

type Ins = ClaimBundle["insurance"];
type Pat = ClaimBundle["patient"];

/**
 * The insured person, and the patient when that is someone else (a child on a
 * parent's plan): lib/edi/subscriber.ts. A dependent's insurance without the
 * insured person's details is stopped by the scrubber before it is sent; here
 * it falls back to the patient so a preview can still be drawn.
 */
export function claimParties(patient: Pat, ins: Ins) {
  const p = { lastName: patient.lastName, firstName: patient.firstName, dob: patient.dob, sex: patient.sex, address1: patient.address1, city: patient.city, state: patient.state, zip: patient.zip };
  const plan = { memberId: ins.memberId, groupNumber: ins.groupNumber, relationship: ins.relationship };
  if (ins.relationship === "self" || !ins.subscriberLastName || !ins.subscriberFirstName || !ins.subscriberDob) {
    return { subscriber: { ...p, ...plan, relationship: "self" }, patient: p };
  }
  // The insured person's address, or the patient's when left empty (usually the same household).
  const own = !!ins.subscriberAddress1;
  return {
    subscriber: {
      ...plan, lastName: ins.subscriberLastName, firstName: ins.subscriberFirstName, dob: ins.subscriberDob, sex: ins.subscriberSex || "U",
      address1: own ? ins.subscriberAddress1 : p.address1, city: own ? ins.subscriberCity : p.city, state: own ? ins.subscriberState : p.state, zip: own ? ins.subscriberZip : p.zip,
    },
    patient: p,
  };
}

/** The 837 (P, I or D, by claim type) for a claim, without sending it. */
export function buildClaimEdi(
  bundle: ClaimBundle,
  o: { now: Date; authorizationNumber: string | null; attachments: ClaimAttachmentRef[]; otherPayer?: OtherPayer; envelope?: { senderId: string; receiverId: string } },
): string {
  const { now, authorizationNumber, attachments, otherPayer } = o;
  const dental = bundle.claim.claimType === "dental";
  const serviceFacility = facilityFor(bundle);
  const institutional = bundle.claim.claimType === "institutional";
  return dental ? buildEdi837D({
    controlNumber: bundle.claim.controlNumber,
    interchangeControl: String(Math.floor(now.getTime() / 1000) % 1_000_000_000),
    senderId: o.envelope?.senderId ?? "COLLABORATMD",
    receiverId: o.envelope?.receiverId ?? bundle.payer.payerId,
    now,
    billingProvider: { name: bundle.practice.name, npi: bundle.practice.npi, taxId: bundle.practice.taxId, address1: bundle.practice.address1, city: bundle.practice.city, state: bundle.practice.state, zip: bundle.practice.zip, phone: bundle.practice.phone, taxonomy: bundle.provider.taxonomy, individual: bundle.practice.billingEntity === "individual" && bundle.practice.billingLastName ? { lastName: bundle.practice.billingLastName, firstName: bundle.practice.billingFirstName ?? "" } : null },
    rendering: { lastName: bundle.provider.lastName, firstName: bundle.provider.firstName, npi: bundle.provider.npi, taxonomy: bundle.provider.taxonomy },
    payer: { name: bundle.payer.name, payerId: bundle.payer.payerId, type: bundle.payer.type },
    ...claimParties(bundle.patient, bundle.insurance),
    claim: {
      totalCents: bundle.claim.totalCents, placeOfService: bundle.encounter.placeOfService, frequencyCode: bundle.claim.frequencyCode,
      originalPayerClaimNumber: bundle.claim.originalPayerClaimNumber, authorizationNumber, diagnoses: bundle.encounter.diagnoses, attachments,
    },
    lines: bundle.lines.map((l) => ({ cdt: l.cpt, chargeCents: l.chargeCents * l.units, units: l.units, dateOfService: bundle.encounter.dateOfService, tooth: l.tooth, surfaces: l.surfaces, oralCavity: l.oralCavity })),
    otherPayer,
    serviceFacility,
  }) : institutional ? buildEdi837I({
    controlNumber: bundle.claim.controlNumber,
    interchangeControl: String(Math.floor(now.getTime() / 1000) % 1_000_000_000),
    senderId: o.envelope?.senderId ?? "COLLABORATMD",
    receiverId: o.envelope?.receiverId ?? bundle.payer.payerId,
    now,
    billingProvider: { name: bundle.practice.name, npi: bundle.practice.npi, taxId: bundle.practice.taxId, address1: bundle.practice.address1, city: bundle.practice.city, state: bundle.practice.state, zip: bundle.practice.zip, phone: bundle.practice.phone },
    attending: { lastName: bundle.provider.lastName, firstName: bundle.provider.firstName, npi: bundle.provider.npi, taxonomy: bundle.provider.taxonomy },
    payer: { name: bundle.payer.name, payerId: bundle.payer.payerId, type: bundle.payer.type },
    ...claimParties(bundle.patient, bundle.insurance),
    claim: {
      totalCents: bundle.claim.totalCents, frequencyCode: bundle.claim.frequencyCode, originalPayerClaimNumber: bundle.claim.originalPayerClaimNumber,
      authorizationNumber, diagnoses: bundle.encounter.diagnoses, institutional: bundle.claim.institutional!, attachments,
    },
    lines: bundle.lines.map((l) => ({ revenueCode: l.revenueCode ?? "", hcpcs: l.cpt || null, modifiers: l.modifiers, chargeCents: l.chargeCents * l.units, units: l.units, dateOfService: bundle.encounter.dateOfService })),
    otherPayer,
  }) : buildEdi837P({
    controlNumber: bundle.claim.controlNumber,
    interchangeControl: String(Math.floor(now.getTime() / 1000) % 1_000_000_000),
    senderId: o.envelope?.senderId ?? "COLLABORATMD",
    receiverId: o.envelope?.receiverId ?? bundle.payer.payerId,
    now,
    billingProvider: {
      name: bundle.practice.name, npi: bundle.practice.npi, taxId: bundle.practice.taxId, address1: bundle.practice.address1, city: bundle.practice.city, state: bundle.practice.state, zip: bundle.practice.zip, phone: bundle.practice.phone,
      individual: bundle.practice.billingEntity === "individual" && bundle.practice.billingLastName ? { lastName: bundle.practice.billingLastName, firstName: bundle.practice.billingFirstName ?? "" } : null,
    },
    renderingProvider: { lastName: bundle.provider.lastName, firstName: bundle.provider.firstName, npi: bundle.provider.npi, taxonomy: bundle.provider.taxonomy },
    referringProvider: bundle.encounter.referringNpi && bundle.encounter.referringLastName ? { lastName: bundle.encounter.referringLastName, firstName: bundle.encounter.referringFirstName ?? "", npi: bundle.encounter.referringNpi } : null,
    propertyClaimNumber: bundle.encounter.propertyClaimNumber,
    mspType: bundle.insurance.mspType,
    payer: { name: bundle.payer.name, payerId: bundle.payer.payerId, type: bundle.payer.type },
    ...claimParties(bundle.patient, bundle.insurance),
    claim: {
      totalCents: bundle.claim.totalCents, placeOfService: bundle.encounter.placeOfService, frequencyCode: bundle.claim.frequencyCode,
      originalPayerClaimNumber: bundle.claim.originalPayerClaimNumber, authorizationNumber,
      cliaNumber: bundle.lines.some((l) => isLabCode(l.cpt)) ? bundle.practice.cliaNumber : null,
      accident: accidentOf(bundle.encounter),
      dateOfService: bundle.encounter.dateOfService, diagnoses: bundle.encounter.diagnoses, attachments,
    },
    lines: bundle.lines.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers, chargeCents: l.chargeCents * l.units, units: l.units, dxPointers: l.dxPointers, dateOfService: bundle.encounter.dateOfService, minutes: l.minutes, ndc: l.ndc, ndcUnit: l.ndcUnit, ndcQuantity: l.ndcQuantity })),
    otherPayer,
    serviceFacility,
  });
}

/**
 * The visit's location, sent as the service facility (2310C) only when it is
 * not the billing address; payers read an absent 2310C as "same as billing".
 */
export function facilityFor(bundle: ClaimBundle): ServiceFacility | undefined {
  const l = bundle.location;
  if (!l) return undefined;
  const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const p = bundle.practice;
  if (norm(l.address1) === norm(p.address1) && norm(l.city) === norm(p.city) && norm(l.zip).slice(0, 5) === norm(p.zip).slice(0, 5)) return undefined;
  return { name: l.name, npi: l.npi, address1: l.address1, city: l.city, state: l.state, zip: l.zip };
}

/** The encounter's work and accident details, as the claim sends them. */
export function accidentOf(e: ClaimBundle["encounter"]) {
  return { employment: e.relatedEmployment, auto: e.relatedAuto, autoState: e.autoAccidentState, other: e.relatedOther, date: e.accidentDate };
}
