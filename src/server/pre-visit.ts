/**
 * Estimates before the visit: for each upcoming appointment, what the patient
 * is likely to owe, from their coverage (the latest eligibility check) and the
 * payer's contract, for the services this provider usually bills for that
 * kind of visit. The front desk sends it with a link to pay a deposit.
 *
 * "Usually bills" is this provider's most frequent code on past visits of the
 * same type. It is a starting point the front desk can see and change, not a
 * prediction of what will happen in the room.
 */
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createEstimate } from "./billing";
import { createPortalLink } from "./portal";
import { messagePatient } from "./messaging";

const { appointments, patients, providers, patientInsurances, estimates, auditLog } = schema;
const DAY = 86_400_000;

export async function upcomingVisits(db: Db, practiceId: string, days = 14, now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await db
    .select({ appt: appointments, patient: patients, provider: providers })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(providers, eq(providers.id, appointments.providerId))
    .where(and(eq(appointments.practiceId, practiceId), eq(appointments.status, "scheduled"), gte(appointments.startsAt, start), lt(appointments.startsAt, new Date(start.getTime() + days * DAY))))
    .orderBy(asc(appointments.startsAt))
    .limit(300);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.appt.id);
  const patientIds = [...new Set(rows.map((r) => r.patient.id))];
  const [ests, policies] = await Promise.all([
    db.select().from(estimates).where(and(eq(estimates.practiceId, practiceId), inArray(estimates.appointmentId, ids))),
    db.select({ ins: patientInsurances, status: sql<string | null>`(SELECT e.status FROM eligibility_checks e WHERE e.patient_insurance_id = ${patientInsurances.id} ORDER BY e.checked_at DESC LIMIT 1)` })
      .from(patientInsurances).where(and(inArray(patientInsurances.patientId, patientIds), eq(patientInsurances.active, true))).orderBy(asc(patientInsurances.rank)),
  ]);
  return rows.map((r) => ({
    ...r,
    insurance: policies.find((p) => p.ins.patientId === r.patient.id) ?? null,
    estimate: ests.filter((e) => e.appointmentId === r.appt.id).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
  }));
}

/** The code this provider bills most for visits of this type (then for any visit), from the last 180 days. */
export async function typicalService(db: Db, practiceId: string, providerId: string, visitType: string, now = new Date()) {
  const since = new Date(now.getTime() - 180 * DAY).toISOString().slice(0, 10);
  const byType = await db.execute<{ cpt: string; n: string }>(sql`
    SELECT ch.cpt, count(*)::text AS n FROM charges ch JOIN encounters e ON e.id = ch.encounter_id JOIN appointments a ON a.id = e.appointment_id
    WHERE e.practice_id = ${practiceId} AND e.provider_id = ${providerId} AND a.type = ${visitType} AND e.date_of_service >= ${since}
    GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`);
  if (byType.rows[0]) return { cpt: byType.rows[0].cpt, basis: `most common for this provider's ${visitType.replace(/_/g, " ")} visits` };
  const any = await db.execute<{ cpt: string }>(sql`
    SELECT ch.cpt FROM charges ch JOIN encounters e ON e.id = ch.encounter_id
    WHERE e.practice_id = ${practiceId} AND e.provider_id = ${providerId} AND e.date_of_service >= ${since}
    GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`);
  if (any.rows[0]) return { cpt: any.rows[0].cpt, basis: "most common for this provider" };
  return { cpt: "99213", basis: "an established patient office visit (no history for this provider)" };
}

export async function estimateForAppointment(db: Db, practiceId: string, appointmentId: string, userId?: string, cpt?: string) {
  const [a] = await db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
  if (!a) throw new Error("Appointment not found");
  const service = cpt ? { cpt: cpt.trim().toUpperCase(), basis: "chosen by staff" } : await typicalService(db, practiceId, a.providerId, a.type);
  const [ins] = await db.select().from(patientInsurances).where(and(eq(patientInsurances.patientId, a.patientId), eq(patientInsurances.active, true))).orderBy(asc(patientInsurances.rank)).limit(1);
  const est = await createEstimate(db, practiceId, { patientId: a.patientId, patientInsuranceId: ins?.id ?? null, serviceDate: a.startsAt.toISOString().slice(0, 10), lines: [{ cpt: service.cpt, units: 1 }] }, userId);
  const [row] = await db.update(estimates).set({ appointmentId: a.id, basis: { ...(est.basis ?? {}), service: service.basis } }).where(eq(estimates.id, est.id)).returning();
  return row;
}

/**
 * Sends the estimate with a portal link where the patient can pay it as a
 * deposit. The deposit posts as a patient payment and sits as a credit until
 * the visit's charges are billed against it.
 */
export async function requestDeposit(db: Db, practiceId: string, estimateId: string, origin: string, userId?: string) {
  const [e] = await db.select({ est: estimates, appt: appointments }).from(estimates).innerJoin(appointments, eq(appointments.id, estimates.appointmentId)).where(and(eq(estimates.id, estimateId), eq(estimates.practiceId, practiceId))).limit(1);
  if (!e) throw new Error("Estimate not found");
  if (e.est.patientOwesCents < 100) throw new Error("Nothing to collect in advance: the estimate is under $1");
  if (e.appt.startsAt < new Date()) throw new Error("The visit has already happened");
  await db.update(estimates).set({ depositRequestedAt: new Date() }).where(eq(estimates.id, e.est.id));
  const { path, patient } = await createPortalLink(db, practiceId, e.est.patientId, userId, "pay");
  const url = `${origin}${path}`;
  const [practice] = await db.select({ name: schema.practices.name }).from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1);
  const amount = `$${(e.est.patientOwesCents / 100).toFixed(2)}`;
  const when = e.appt.startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const r = await messagePatient(db, patient, {
    kind: "deposit_request",
    sms: `${practice.name}: your estimated cost for your visit on ${when} is ${amount}. See the estimate and pay ahead at ${url} . Reply STOP to opt out.`,
    email: { subject: `Your estimated cost for your visit on ${when}`, text: `Hi ${patient.firstName},\n\nBased on your insurance, your estimated cost for your visit on ${when} is ${amount}. This is an estimate; your final bill depends on the care you receive.\n\nYou can pay it ahead of time here:\n\n${url}\n\n${practice.name}` },
  });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "deposit_requested", entity: "estimate", entityId: e.est.id, details: { amountCents: e.est.patientOwesCents } });
  return { url, sms: r.sms, email: r.email, reason: r.reason };
}

/** Deposits a patient has been asked for, for visits still ahead. The portal lets them pay up to this on top of their balance. */
export async function openDeposits(db: Db, patientId: string, now = new Date()) {
  return db
    .select({ id: estimates.id, amountCents: estimates.patientOwesCents, startsAt: appointments.startsAt })
    .from(estimates)
    .innerJoin(appointments, eq(appointments.id, estimates.appointmentId))
    .where(and(eq(estimates.patientId, patientId), isNotNull(estimates.depositRequestedAt), gte(appointments.startsAt, now), eq(appointments.status, "scheduled")));
}

