/**
 * An explanation of benefits for a claim, rebuilt from the payer's 835s: what
 * was charged, allowed, paid, adjusted (with the CARC group and reason) and
 * left to the patient, claim and line by line. Printed with a paper claim to
 * a secondary payer that does not take electronic coordination of benefits.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { parseEdi835, type RemitClaim } from "@/lib/edi/x835";

const { claims, ledgerEntries, remittances, payers, patients, patientInsurances, practices, encounters } = schema;

export async function eobFor(db: Db, practiceId: string, claimId: string) {
  const [row] = await db.select({ claim: claims, payer: payers, patient: patients, insurance: patientInsurances, practice: practices, dos: encounters.dateOfService })
    .from(claims).innerJoin(payers, eq(payers.id, claims.payerId)).innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(patientInsurances, eq(patientInsurances.id, claims.patientInsuranceId)).innerJoin(practices, eq(practices.id, claims.practiceId))
    .innerJoin(encounters, eq(encounters.id, claims.encounterId))
    .where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!row) return null;
  const remitIds = [...new Set((await db.select({ id: ledgerEntries.remittanceId }).from(ledgerEntries).where(eq(ledgerEntries.claimId, claimId))).map((r) => r.id).filter((x): x is string => !!x))];
  const remits = remitIds.length ? await db.select().from(remittances).where(and(inArray(remittances.id, remitIds), eq(remittances.practiceId, practiceId))) : [];
  const payments: { payerName: string; checkNumber: string; paymentDate: string; claim: RemitClaim }[] = [];
  for (const r of remits.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate))) {
    const parsed = parseEdi835(r.raw835);
    for (const c of parsed.claims.filter((x) => x.patientControlNumber === row.claim.controlNumber)) payments.push({ payerName: r.payerName, checkNumber: r.checkNumber, paymentDate: r.paymentDate, claim: c });
  }
  return { ...row, payments };
}

/** Allowed amount from an 835 claim: what was charged less the contractual (CO) adjustments. */
export const allowedFrom = (c: RemitClaim) => c.chargedCents - [...c.adjustments, ...c.lines.flatMap((l) => l.adjustments)].filter((a) => a.group === "CO").reduce((s, a) => s + a.amountCents, 0);
