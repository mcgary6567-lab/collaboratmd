/**
 * A claim as a CMS-1500 paper form, for payers that take paper (many workers'
 * comp and auto insurers, some small plans). The same data as the 837P; the
 * layout is in lib/cms1500.ts.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { cms1500Pages, type Cms1500Input } from "@/lib/cms1500";
import { loadClaimBundle } from "./claims";
import { claimParties } from "./claim-edi";

const { patientInsurances, claims, auditLog } = schema;

export async function paperClaim(db: Db, practiceId: string, claimId: string, today = new Date()) {
  const b = await loadClaimBundle(db, claimId);
  if (!b || b.claim.practiceId !== practiceId) return null;
  const { subscriber } = claimParties(b.patient, b.insurance);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(patientInsurances)
    .where(and(eq(patientInsurances.patientId, b.patient.id), eq(patientInsurances.active, true), ne(patientInsurances.id, b.insurance.id)));
  const individual = b.practice.billingEntity === "individual" && b.practice.billingLastName;
  const input: Cms1500Input = {
    payer: { name: b.payer.name, type: b.payer.type },
    insured: {
      id: b.insurance.memberId, lastName: subscriber.lastName, firstName: subscriber.firstName, address1: subscriber.address1, city: subscriber.city,
      state: subscriber.state, zip: subscriber.zip, phone: subscriber.relationship === "self" ? b.patient.phone : null, dob: subscriber.dob, sex: subscriber.sex,
      groupNumber: b.insurance.groupNumber, planName: null,
    },
    patient: {
      lastName: b.patient.lastName, firstName: b.patient.firstName, dob: b.patient.dob, sex: b.patient.sex, address1: b.patient.address1, city: b.patient.city,
      state: b.patient.state, zip: b.patient.zip, phone: b.patient.phone, accountNumber: b.claim.controlNumber,
    },
    relationship: subscriber.relationship,
    otherInsurance: Number(n) > 0,
    accident: { employment: b.encounter.relatedEmployment, auto: b.encounter.relatedAuto, autoState: b.encounter.autoAccidentState, other: b.encounter.relatedOther, date: b.encounter.accidentDate, propertyClaimNumber: b.encounter.propertyClaimNumber },
    referring: b.encounter.referringNpi && b.encounter.referringLastName ? { lastName: b.encounter.referringLastName, firstName: b.encounter.referringFirstName ?? "", npi: b.encounter.referringNpi } : null,
    supervising: b.supervisor && b.supervisor.npi !== b.provider.npi ? { lastName: b.supervisor.lastName, firstName: b.supervisor.firstName, npi: b.supervisor.npi } : null,
    priorAuth: b.claim.authorizationNumber,
    resubmission: (b.claim.frequencyCode === "7" || b.claim.frequencyCode === "8") && b.claim.originalPayerClaimNumber ? { code: b.claim.frequencyCode, originalRef: b.claim.originalPayerClaimNumber } : null,
    diagnoses: b.encounter.diagnoses,
    lines: b.lines.map((l) => ({ from: b.encounter.dateOfService, pos: b.encounter.placeOfService, cpt: l.cpt, modifiers: l.modifiers, pointers: l.dxPointers, chargeCents: l.chargeCents, units: l.units, renderingNpi: b.provider.npi, ndc: l.ndc, ndcUnit: l.ndcUnit, ndcQuantity: l.ndcQuantity, description: l.description })),
    totalCents: b.claim.totalCents,
    paidCents: 0,
    billing: {
      name: individual ? `${b.practice.billingLastName}, ${b.practice.billingFirstName ?? ""}` : b.practice.name,
      address1: b.practice.address1, city: b.practice.city, state: b.practice.state, zip: b.practice.zip, phone: b.practice.phone, npi: b.practice.npi, taxId: b.practice.taxId,
    },
    facility: b.location ? { name: b.location.name, address1: b.location.address1, city: b.location.city, state: b.location.state, zip: b.location.zip, npi: b.location.npi } : null,
    signedOn: today.toISOString().slice(0, 10),
  };
  return { bundle: b, pages: cms1500Pages(input), offset: { x: b.practice.formOffsetX / 10, y: b.practice.formOffsetY / 10 } };
}

/** Marks a claim as sent on paper, the way a clearinghouse submission would. */
export async function markMailed(db: Db, practiceId: string, claimId: string, userId?: string) {
  const [c] = await db.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!c) throw new Error("Claim not found");
  if (!["ready", "rejected"].includes(c.status)) throw new Error("Only a ready claim can be marked as mailed");
  const now = new Date();
  await db.update(claims).set({ status: "submitted", submittedAt: now, updatedAt: now }).where(eq(claims.id, claimId));
  await db.insert(schema.claimEvents).values({ claimId, status: "submitted", source: "user", message: "Printed on a CMS-1500 and mailed" });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "claim_mailed", entity: "claim", entityId: claimId });
}
