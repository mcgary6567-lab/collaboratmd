/**
 * Appeal letters for denials: drafted (by AI from codes only, or from a
 * template), filled with the claim's details on our server, edited by the
 * biller, printed, and marked sent, which moves the denial to "appealed".
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { draftAppealBody } from "@/lib/ai/appeal";
import { fillPlaceholders, templateLetter, wrapBody } from "@/lib/appeals";
import { practiceConfig } from "./integrations";

const { appealLetters, denials, claims, patients, patientInsurances, payers, practices, encounters, charges, providers, claimEvents } = schema;

async function loadDenial(db: Db, practiceId: string, denialId: string) {
  const [row] = await db
    .select({ denial: denials, claim: claims, patient: patients, insurance: patientInsurances, payer: payers, practice: practices, encounter: encounters, provider: providers })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(patientInsurances, eq(patientInsurances.id, claims.patientInsuranceId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(practices, eq(practices.id, claims.practiceId))
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .innerJoin(providers, eq(providers.id, encounters.providerId))
    .where(and(eq(denials.id, denialId), eq(denials.practiceId, practiceId)))
    .limit(1);
  if (!row) throw new Error("Denial not found");
  const lines = await db.select().from(charges).where(eq(charges.encounterId, row.encounter.id)).orderBy(asc(charges.lineNumber));
  return { ...row, lines };
}

export async function getAppeal(db: Db, practiceId: string, denialId: string) {
  const d = await loadDenial(db, practiceId, denialId);
  const [letter] = await db.select().from(appealLetters).where(eq(appealLetters.denialId, denialId)).orderBy(desc(appealLetters.createdAt)).limit(1);
  return { ...d, letter: letter ?? null };
}

/** Drafts (or redrafts) the letter for a denial and saves it as a draft. */
export async function draftAppeal(db: Db, practiceId: string, denialId: string, userId?: string) {
  const d = await loadDenial(db, practiceId, denialId);
  const cpts = d.lines.map((l) => l.cpt);
  const body = await draftAppealBody({ carc: d.denial.carc, rarc: d.denial.rarc, category: d.denial.category, cpts, diagnoses: d.encounter.diagnoses, payerType: d.payer.type }, (await practiceConfig(db, practiceId)).anthropic?.apiKey);
  const template = body ? wrapBody(body) : templateLetter(d.denial.category);
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const date = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const filled = fillPlaceholders(template, {
    PRACTICE_NAME: d.practice.name,
    PRACTICE_ADDRESS: `${d.practice.address1}, ${d.practice.city}, ${d.practice.state} ${d.practice.zip}`,
    PRACTICE_PHONE: d.practice.phone ?? "",
    GROUP_NPI: d.practice.npi,
    TAX_ID: d.practice.taxId,
    PAYER_NAME: d.payer.name,
    PATIENT_NAME: `${d.patient.firstName} ${d.patient.lastName}`,
    PATIENT_DOB: date(d.patient.dob),
    MEMBER_ID: d.insurance.memberId,
    CLAIM_NUMBER: d.claim.controlNumber,
    PAYER_CLAIM_NUMBER: d.claim.payerClaimNumber ?? "(not assigned)",
    DATE_OF_SERVICE: date(d.encounter.dateOfService),
    BILLED_AMOUNT: money(d.claim.totalCents),
    DENIED_AMOUNT: money(d.denial.amountCents),
    PROVIDER_NAME: `${d.provider.firstName} ${d.provider.lastName}`,
    PROCEDURES: d.lines.map((l) => `${l.cpt}${l.modifiers.length ? `-${l.modifiers.join("-")}` : ""}${l.description ? ` (${l.description})` : ""}`).join(", "),
    DIAGNOSES: d.encounter.diagnoses.join(", "),
    DENIAL_CODES: `CARC ${d.denial.carc}${d.denial.rarc ? `, RARC ${d.denial.rarc}` : ""}`,
    TODAY: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
  });
  const [letter] = await db
    .insert(appealLetters)
    .values({ practiceId, denialId, body: filled, source: body ? "ai" : "template", createdBy: userId ?? null })
    .returning();
  return letter;
}

export async function saveAppeal(db: Db, practiceId: string, letterId: string, body: string) {
  if (!body.trim()) throw new Error("The letter is empty");
  await db.update(appealLetters).set({ body: body.slice(0, 20_000), updatedAt: new Date() }).where(and(eq(appealLetters.id, letterId), eq(appealLetters.practiceId, practiceId)));
}

/** Marks the letter sent; the denial becomes "appealed" and the claim's timeline says so. */
export async function markAppealSent(db: Db, practiceId: string, letterId: string, userId?: string) {
  const [letter] = await db.select().from(appealLetters).where(and(eq(appealLetters.id, letterId), eq(appealLetters.practiceId, practiceId))).limit(1);
  if (!letter) throw new Error("Letter not found");
  await db.update(appealLetters).set({ status: "sent", sentAt: new Date() }).where(eq(appealLetters.id, letterId));
  const [denial] = await db.update(denials).set({ status: "appealed" }).where(eq(denials.id, letter.denialId)).returning();
  await db.insert(claimEvents).values({ claimId: denial.claimId, status: "appealed", source: "user", message: `Appeal letter sent for CARC ${denial.carc}` });
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "appeal_sent", entity: "denial", entityId: denial.id });
}
