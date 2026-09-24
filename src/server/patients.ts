import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";

const { patients, patientInsurances, payers, eligibilityChecks, encounters, ledgerEntries } = schema;

export async function searchPatients(db: Db, practiceId: string, q?: string) {
  const term = q?.trim();
  const where = term
    ? and(eq(patients.practiceId, practiceId), or(ilike(patients.lastName, `%${term}%`), ilike(patients.firstName, `%${term}%`), ilike(patients.mrn, `%${term}%`)))
    : eq(patients.practiceId, practiceId);
  return db.select().from(patients).where(where).orderBy(asc(patients.lastName), asc(patients.firstName)).limit(100);
}

export async function getPatient(db: Db, practiceId: string, id: string) {
  const [patient] = await db.select().from(patients).where(and(eq(patients.id, id), eq(patients.practiceId, practiceId))).limit(1);
  if (!patient) return null;
  const insurances = await db
    .select({ insurance: patientInsurances, payer: payers })
    .from(patientInsurances)
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(eq(patientInsurances.patientId, id))
    .orderBy(asc(patientInsurances.rank));
  const checks = await db
    .select()
    .from(eligibilityChecks)
    .where(sql`${eligibilityChecks.patientInsuranceId} IN (SELECT id FROM patient_insurances WHERE patient_id = ${id})`)
    .orderBy(desc(eligibilityChecks.checkedAt))
    .limit(5);
  const visits = await db.select().from(encounters).where(eq(encounters.patientId, id)).orderBy(desc(encounters.dateOfService));
  const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.patientId, id)).orderBy(desc(ledgerEntries.postedAt)).limit(50);
  return { patient, insurances, checks, visits, ledger };
}

export interface NewPatientInput {
  firstName: string;
  lastName: string;
  dob: string;
  sex: string;
  phone?: string;
  email?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  payerId: string;
  memberId: string;
  groupNumber?: string;
  relationship: string;
  copayCents: number;
}

export async function createPatient(db: Db, practiceId: string, input: NewPatientInput) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(patients).where(eq(patients.practiceId, practiceId));
  const [p] = await db
    .insert(patients)
    .values({
      practiceId,
      mrn: "P" + String(Number(n) + 1001).padStart(5, "0"),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      dob: input.dob,
      sex: input.sex,
      phone: input.phone || null,
      email: input.email || null,
      address1: input.address1 || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
    })
    .returning();
  await db.insert(patientInsurances).values({ patientId: p.id, payerId: input.payerId, memberId: input.memberId.trim(), groupNumber: input.groupNumber || null, rank: 1, relationship: input.relationship, copayCents: input.copayCents });
  return p;
}

export async function runEligibility(db: Db, patientInsuranceId: string) {
  const [row] = await db
    .select({ ins: patientInsurances, patient: patients, payer: payers })
    .from(patientInsurances)
    .innerJoin(patients, eq(patients.id, patientInsurances.patientId))
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(eq(patientInsurances.id, patientInsuranceId))
    .limit(1);
  if (!row) throw new Error("Insurance not found");
  const result = await getClearinghouse().checkEligibility({
    memberId: row.ins.memberId,
    payerId: row.payer.payerId,
    dob: row.patient.dob,
    lastName: row.patient.lastName,
    firstName: row.patient.firstName,
    serviceDate: new Date().toISOString().slice(0, 10),
  });
  const [check] = await db
    .insert(eligibilityChecks)
    .values({
      patientInsuranceId,
      status: result.status,
      planName: result.planName ?? null,
      copayCents: result.copayCents ?? null,
      deductibleCents: result.deductibleCents ?? null,
      deductibleRemainingCents: result.deductibleRemainingCents ?? null,
      oopMaxCents: result.oopMaxCents ?? null,
      coinsurancePct: result.coinsurancePct ?? null,
      oopRemainingCents: result.oopRemainingCents ?? null,
      response: result.raw,
    })
    .returning();
  if (result.copayCents) await db.update(patientInsurances).set({ copayCents: result.copayCents }).where(eq(patientInsurances.id, patientInsuranceId));
  return check;
}

export async function postPatientPayment(db: Db, practiceId: string, patientId: string, amountCents: number, method: string, userId?: string) {
  await db.insert(ledgerEntries).values({ practiceId, patientId, type: "patient_payment", amountCents, note: `Patient payment (${method})`, postedBy: userId ?? null });
}
