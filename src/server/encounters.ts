import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createClaimForEncounter } from "./claims";
import { standardCharges } from "./fees";
import { isValidNpi } from "@/lib/scrub/rules";
import { isUsState } from "@/lib/us";
import { commonDiagnoses, procedureCatalog } from "./code-catalog";

const { encounters, charges, appointments, patients, providers, cptCodes } = schema;

export interface NewEncounterInput {
  patientId: string;
  providerId: string;
  appointmentId?: string | null;
  dateOfService: string;
  placeOfService: string;
  locationId?: string | null;
  diagnoses: string[];
  lines: { cpt: string; modifiers: string[]; units: number; chargeCents: number; dxPointers: number[]; description?: string }[];
  /** The provider who referred the patient, when the payer needs one on the claim. */
  referring?: { lastName: string; firstName?: string; npi: string } | null;
  /** Related to work or an accident: box 10 of the claim form, CLM11 on the 837. */
  accident?: AccidentInput | null;
}

export type AccidentInput = { employment: boolean; auto: boolean; autoState?: string | null; other: boolean; date?: string | null; claimNumber?: string | null; employer?: string | null };

/** Encounter columns for the work and accident details, checked. */
export function accidentColumns(a: AccidentInput | null | undefined) {
  const state = a?.auto ? a.autoState?.trim().toUpperCase() || null : null;
  if (state && !isUsState(state)) throw new Error(`${state} is not a US state`);
  const date = a?.date?.trim() || null;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Enter the accident date as a date");
  return {
    relatedEmployment: !!a?.employment, relatedAuto: !!a?.auto, autoAccidentState: state, relatedOther: !!a?.other,
    accidentDate: a && (a.employment || a.auto || a.other) ? date : null,
    propertyClaimNumber: a?.claimNumber?.trim().slice(0, 50) || null,
    employerName: a?.employment ? a.employer?.trim().slice(0, 80) || null : null,
  };
}

export async function createEncounterWithClaim(db: Db, practiceId: string, input: NewEncounterInput, userId?: string) {
  const ref = input.referring?.npi?.trim() ? { ...input.referring, npi: input.referring.npi.replace(/\D/g, "") } : null;
  if (ref && !isValidNpi(ref.npi)) throw new Error("The referring provider's NPI fails its check digit");
  if (ref && !ref.lastName.trim()) throw new Error("Enter the referring provider's last name");
  const accident = accidentColumns(input.accident);
  const [enc] = await db
    .insert(encounters)
    .values({
      practiceId,
      patientId: input.patientId,
      providerId: input.providerId,
      appointmentId: input.appointmentId ?? null,
      dateOfService: input.dateOfService,
      placeOfService: input.placeOfService,
      locationId: input.locationId ?? null,
      diagnoses: input.diagnoses.map((d) => d.toUpperCase().trim()).filter(Boolean),
      referringLastName: ref?.lastName.trim().slice(0, 60) ?? null,
      referringFirstName: ref?.firstName?.trim().slice(0, 35) || null,
      referringNpi: ref?.npi ?? null,
      ...accident,
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
/**
 * Codes to offer without typing: the practice's procedures with its fees, and
 * its most used diagnoses (the full ICD-10-CM list is searched as you type).
 */
export async function listCodes(db: Db, practiceId?: string) {
  if (!practiceId) {
    const [cpts, icds] = await Promise.all([db.select().from(cptCodes).orderBy(asc(cptCodes.code)), commonDiagnoses(db, undefined)]);
    return { cpts, icds };
  }
  const [catalog, fees, icds] = await Promise.all([procedureCatalog(db, practiceId), standardCharges(db, practiceId), commonDiagnoses(db, practiceId)]);
  return { cpts: catalog.map((c) => ({ ...c, defaultFeeCents: fees.get(c.code) ?? c.defaultFeeCents })), icds };
}

/** One day's appointments. `day` is any clock time on that day (appointment times are clock times; see practice-time.ts). */
export async function listAppointments(db: Db, practiceId: string, day: Date) {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return db
    .select({ appt: appointments, patient: patients, provider: providers })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(providers, eq(providers.id, appointments.providerId))
    .where(and(eq(appointments.practiceId, practiceId), gte(appointments.startsAt, start), lt(appointments.startsAt, end)))
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

/** Providers for pickers: active ones unless `includeInactive`. */
export async function listProviders(db: Db, practiceId: string, includeInactive = false) {
  return db.select().from(providers).where(includeInactive ? eq(providers.practiceId, practiceId) : and(eq(providers.practiceId, practiceId), eq(providers.active, true))).orderBy(asc(providers.lastName));
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
