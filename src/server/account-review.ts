/**
 * Keeping patient accounts addressed to the right person.
 *
 *  - Returned mail: when a statement or letter comes back, the address is
 *    marked bad. Nothing more is mailed there until it is corrected (a
 *    database trigger clears the mark whenever the address changes, however
 *    it changes: staff, online check-in, HL7, import), and the front desk is
 *    asked to confirm the address at the next visit.
 *  - Adult dependents: a dependent who has turned 18 is billed on their own
 *    account unless they agreed to keep the guarantor, so a parent does not
 *    keep receiving statements that list an adult child's care.
 */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { schema } from "@/db";
import { patientBalanceSql } from "./billing";

const { patients, auditLog } = schema;

const isDay = (v: string | undefined | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Whether someone born on `dob` is 18 or older on `on` (YYYY-MM-DD). */
export function isAdult(dob: string, on: string) {
  const [y, rest] = [Number(on.slice(0, 4)), on.slice(4)];
  return dob <= `${y - 18}${rest}`;
}

async function ownPatient(db: Db, practiceId: string, patientId: string) {
  const [p] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  return p;
}

/* ------------------------------ Returned mail ------------------------------ */

export async function markMailReturned(db: Db, practiceId: string, patientId: string, input: { on?: string; note?: string }, userId?: string) {
  const p = await ownPatient(db, practiceId, patientId);
  const on = isDay(input.on) ? input.on! : new Date().toISOString().slice(0, 10);
  const note = input.note?.trim().slice(0, 300) || null;
  await db.update(patients).set({ addressBadSince: p.addressBadSince ?? on, addressBadNote: note ?? p.addressBadNote }).where(eq(patients.id, p.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "mail_returned", entity: "patient", entityId: p.id, details: { on, note } });
}

/** Corrects the mailing address (clearing a returned-mail mark), or confirms the address on file is right. */
export async function updateAddress(db: Db, practiceId: string, patientId: string, input: { address1: string; city: string; state: string; zip: string }, userId?: string) {
  const p = await ownPatient(db, practiceId, patientId);
  const address1 = input.address1.trim().slice(0, 100);
  const city = input.city.trim().slice(0, 60);
  const state = input.state.trim().toUpperCase();
  const zip = input.zip.trim();
  if (!address1 || !city) throw new Error("Enter the street address and city");
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Choose the state");
  if (!/^\d{5}(-?\d{4})?$/.test(zip)) throw new Error("The ZIP code is 5 or 9 digits");
  const same = p.address1 === address1 && p.city === city && p.state === state && p.zip === zip;
  // An unchanged address the patient confirmed is right: clear the mark by hand (the trigger only fires on a change).
  await db.update(patients).set(same ? { addressBadSince: null, addressBadNote: null } : { address1, city, state, zip }).where(eq(patients.id, p.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: same ? "address_confirmed" : "address_updated", entity: "patient", entityId: p.id, details: { hadReturnedMail: !!p.addressBadSince } });
}

/** Patients whose mail came back, with what they owe and their next visit (to confirm the address then). */
export async function returnedMail(db: Db, practiceId: string) {
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT p.id, p.mrn, p.first_name, p.last_name, p.address1, p.city, p.state, p.zip, p.phone, p.email,
      p.address_bad_since::text AS since, p.address_bad_note AS note,
      (SELECT (${patientBalanceSql})::text FROM ledger_entries WHERE patient_id = p.id) AS balance,
      (SELECT min(a.starts_at)::text FROM appointments a WHERE a.patient_id = p.id AND a.status = 'scheduled' AND a.starts_at > now()) AS next_visit
    FROM patients p
    WHERE p.practice_id = ${practiceId} AND p.address_bad_since IS NOT NULL AND p.merged_into IS NULL
    ORDER BY p.address_bad_since`);
  return rows.map((r) => ({
    id: r.id!, mrn: r.mrn!, name: `${r.last_name}, ${r.first_name}`, address: [r.address1, r.city, r.state, r.zip].filter(Boolean).join(", "),
    phone: r.phone, email: r.email, since: r.since!, note: r.note, balanceCents: Number(r.balance ?? 0), nextVisit: r.next_visit ? new Date(r.next_visit) : null,
  }));
}

/* ------------------------------ Adult dependents ------------------------------ */

/** Dependents who are now 18 or older and have not agreed to keep their bill with the guarantor. */
export async function adultDependents(db: Db, practiceId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const cutoff = `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
  const gp = alias(patients, "gp");
  const rows = await db.select({ p: patients, guarantorFirst: gp.firstName, guarantorLast: gp.lastName, guarantorId: gp.id }).from(patients)
    .innerJoin(gp, eq(gp.id, patients.guarantorId))
    .where(and(eq(patients.practiceId, practiceId), isNotNull(patients.guarantorId), isNull(patients.guarantorAdultConsentOn), isNull(patients.mergedInto), sql`${patients.dob} <= ${cutoff}`))
    .orderBy(asc(patients.dob));
  return rows.map((r) => ({ id: r.p.id, mrn: r.p.mrn, name: `${r.p.lastName}, ${r.p.firstName}`, dob: r.p.dob, guarantorId: r.guarantorId, guarantor: `${r.guarantorLast}, ${r.guarantorFirst}` }));
}

/** The adult patient agreed to keep their bill with the guarantor. */
export async function recordAdultConsent(db: Db, practiceId: string, patientId: string, on: string, userId?: string) {
  const p = await ownPatient(db, practiceId, patientId);
  if (!p.guarantorId) throw new Error("This patient has no guarantor");
  if (!isDay(on)) throw new Error("Enter the date the patient agreed");
  await db.update(patients).set({ guarantorAdultConsentOn: on }).where(eq(patients.id, p.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "guarantor_adult_consent", entity: "patient", entityId: p.id, details: { on } });
}

/** Moves an adult dependent onto their own account. */
export async function releaseAdultDependent(db: Db, practiceId: string, patientId: string, userId?: string) {
  const p = await ownPatient(db, practiceId, patientId);
  if (!p.guarantorId) throw new Error("This patient has no guarantor");
  await db.update(patients).set({ guarantorId: null, guarantorAdultConsentOn: null }).where(eq(patients.id, p.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "guarantor_set", entity: "patient", entityId: p.id, details: { guarantorId: null, reason: "adult" } });
}
