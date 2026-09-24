import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createClaimForEncounter } from "./claims";
import { standardCharges } from "./fees";

const { encounters, charges, appointments, patients, providers, cptCodes, icd10Codes } = schema;

export interface NewEncounterInput {
  patientId: string;
  providerId: string;
  appointmentId?: string | null;
  dateOfService: string;
  placeOfService: string;
  diagnoses: string[];
  lines: { cpt: string; modifiers: string[]; units: number; chargeCents: number; dxPointers: number[]; description?: string }[];
}

export async function createEncounterWithClaim(db: Db, practiceId: string, input: NewEncounterInput, userId?: string) {
  const [enc] = await db
    .insert(encounters)
    .values({
      practiceId,
      patientId: input.patientId,
      providerId: input.providerId,
      appointmentId: input.appointmentId ?? null,
      dateOfService: input.dateOfService,
      placeOfService: input.placeOfService,
      diagnoses: input.diagnoses.map((d) => d.toUpperCase().trim()).filter(Boolean),
    })
    .returning();
  let n = 1;
  for (const l of input.lines) {
    await db.insert(charges).values({ encounterId: enc.id, lineNumber: n++, cpt: l.cpt.trim(), modifiers: l.modifiers.map((m) => m.toUpperCase().trim()).filter(Boolean), units: l.units, chargeCents: l.chargeCents, dxPointers: l.dxPointers, description: l.description ?? null });
  }
  if (input.appointmentId) await db.update(appointments).set({ status: "completed" }).where(eq(appointments.id, input.appointmentId));
  const claim = await createClaimForEncounter(db, enc.id, userId);
  return { encounter: enc, claim };
}

/**
 * Codes for charge entry. With a practice, each code's fee is that practice's
 * standard charge where its schedule sets one, falling back to the default.
 */
export async function listCodes(db: Db, practiceId?: string) {
  const cpts = await db.select().from(cptCodes).orderBy(asc(cptCodes.code));
  const icds = await db.select().from(icd10Codes).orderBy(asc(icd10Codes.code));
  if (!practiceId) return { cpts, icds };
  const fees = await standardCharges(db, practiceId);
  return { cpts: cpts.map((c) => ({ ...c, defaultFeeCents: fees.get(c.code) ?? c.defaultFeeCents })), icds };
}

export async function listAppointments(db: Db, practiceId: string, day: Date) {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return db
    .select({ appt: appointments, patient: patients, provider: providers })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(providers, eq(providers.id, appointments.providerId))
    .where(and(eq(appointments.practiceId, practiceId), gte(appointments.startsAt, start), lte(appointments.startsAt, end)))
    .orderBy(asc(appointments.startsAt));
}

export async function createAppointment(db: Db, practiceId: string, input: { patientId: string; providerId: string; startsAt: Date; minutes: number; type: string; reason?: string }) {
  const endsAt = new Date(input.startsAt.getTime() + input.minutes * 60_000);
  const [a] = await db.insert(appointments).values({ practiceId, patientId: input.patientId, providerId: input.providerId, startsAt: input.startsAt, endsAt, type: input.type, reason: input.reason ?? null }).returning();
  return a;
}

export async function setAppointmentStatus(db: Db, id: string, status: string) {
  await db.update(appointments).set({ status }).where(eq(appointments.id, id));
}

export async function listProviders(db: Db, practiceId: string) {
  return db.select().from(providers).where(eq(providers.practiceId, practiceId)).orderBy(asc(providers.lastName));
}

export async function listPayers(db: Db, practiceId: string) {
  return db.select().from(schema.payers).where(eq(schema.payers.practiceId, practiceId)).orderBy(asc(schema.payers.name));
}

export async function recentEncounters(db: Db, practiceId: string) {
  return db
    .select({ encounter: encounters, patient: patients, provider: providers })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .innerJoin(providers, eq(providers.id, encounters.providerId))
    .where(eq(encounters.practiceId, practiceId))
    .orderBy(desc(encounters.dateOfService))
    .limit(50);
}
