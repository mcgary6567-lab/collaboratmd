/**
 * Superbills: an itemized statement of a visit that the patient files with
 * their own insurer for out-of-network reimbursement. It carries what an
 * insurer needs to process the claim: the practice's name, address, tax ID
 * and NPI, the rendering provider's NPI, the patient, the date and place of
 * service, each procedure code with modifiers, units and charge, the
 * diagnosis codes, and what the patient paid.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { encounters, charges, patients, providers, practices, claims, cptCodes, icd10Codes, patientInsurances, payers, locations } = schema;

export async function superbillFor(db: Db, practiceId: string, encounterId: string) {
  const [row] = await db.select({ e: encounters, p: patients, prov: providers, practice: practices, location: locations }).from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId)).innerJoin(providers, eq(providers.id, encounters.providerId))
    .innerJoin(practices, eq(practices.id, encounters.practiceId)).leftJoin(locations, eq(locations.id, encounters.locationId))
    .where(and(eq(encounters.id, encounterId), eq(encounters.practiceId, practiceId))).limit(1);
  if (!row) return null;
  const lines = await db.select({ c: charges, description: cptCodes.description }).from(charges).leftJoin(cptCodes, eq(cptCodes.code, charges.cpt))
    .where(eq(charges.encounterId, encounterId)).orderBy(charges.lineNumber);
  const dx = row.e.diagnoses;
  const dxRows = dx.length ? await db.select().from(icd10Codes).where(inArray(icd10Codes.code, [...dx, ...dx.map((d) => d.replace(".", ""))])) : [];
  const describe = (code: string) => dxRows.find((r) => r.code === code || r.code === code.replace(".", ""))?.description ?? null;
  const claimIds = (await db.select({ id: claims.id }).from(claims).where(eq(claims.encounterId, encounterId))).map((c) => c.id);
  const [{ paid }] = (await db.execute<{ paid: string }>(sql`
    SELECT COALESCE(sum(amount_cents) FILTER (WHERE type = 'patient_payment'), 0) - COALESCE(sum(amount_cents) FILTER (WHERE type = 'refund'), 0) AS paid
    FROM ledger_entries WHERE patient_id = ${row.p.id} AND (
      ${claimIds.length ? sql`claim_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(claimIds)}::jsonb)::uuid) OR` : sql``}
      (claim_id IS NULL AND posted_at::date = ${row.e.dateOfService}))`)).rows;
  const [ins] = await db.select({ payer: payers.name, memberId: patientInsurances.memberId, type: payers.type }).from(patientInsurances).innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.patientId, row.p.id), eq(patientInsurances.active, true))).orderBy(patientInsurances.rank).limit(1);
  const items = lines.map((l) => ({ lineNumber: l.c.lineNumber, cpt: l.c.cpt, modifiers: l.c.modifiers, units: l.c.units, chargeCents: l.c.chargeCents * l.c.units, description: l.description ?? l.c.description ?? "", dxPointers: l.c.dxPointers }));
  return {
    ...row,
    items,
    diagnoses: dx.map((code, i) => ({ pointer: String.fromCharCode(65 + i), code, description: describe(code) })),
    totalCents: items.reduce((a, i) => a + i.chargeCents, 0),
    paidCents: Number(paid),
    insurance: ins && ins.type !== "self_pay" ? ins : null,
  };
}

/** The patient's visits that can have a superbill, newest first. */
export async function superbillVisits(db: Db, practiceId: string, patientId: string) {
  return db.select({ id: encounters.id, dateOfService: encounters.dateOfService }).from(encounters)
    .where(and(eq(encounters.patientId, patientId), eq(encounters.practiceId, practiceId))).orderBy(sql`${encounters.dateOfService} DESC`).limit(24);
}
