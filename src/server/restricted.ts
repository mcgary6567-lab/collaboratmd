/**
 * Restricted patients ("break the glass"): a practice can mark a patient whose
 * records need extra care (a staff member, someone well known). Opening that
 * patient's chart, claims, statements or estimates then asks for a reason;
 * the reason is kept in the access log and the administrators are told. The
 * opening lasts GRANT_HOURS for that person and patient.
 *
 * What is covered: the chart, claim, statement and estimate pages. Lists
 * (patients, claims, the schedule) still show the name, so the front desk and
 * billers can find and work the account; exports and the API are not gated.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notify } from "./notifications";

const { patients, auditLog, users } = schema;
export const GRANT_HOURS = 4;

export async function restrictedAccess(db: Db, who: { practiceId: string; userId: string }, patientId: string, now = new Date()) {
  const [p] = await db.select({ restricted: patients.restricted }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, who.practiceId))).limit(1);
  if (!p?.restricted) return { restricted: false, granted: true };
  // A reason given before the patient was (last) restricted does not count: restricting again asks everyone again.
  const [last] = await db
    .select({ at: sql<string | null>`max(${auditLog.at})` })
    .from(auditLog)
    .where(and(eq(auditLog.practiceId, who.practiceId), eq(auditLog.action, "patient_restricted"), eq(auditLog.entityId, patientId)));
  const windowStart = now.getTime() - GRANT_HOURS * 3_600_000;
  const since = new Date(Math.max(windowStart, last?.at ? new Date(last.at).getTime() : 0));
  const [grant] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.practiceId, who.practiceId), eq(auditLog.userId, who.userId), eq(auditLog.action, "restricted_record_opened"), eq(auditLog.entityId, patientId), gte(auditLog.at, since)))
    .limit(1);
  return { restricted: true, granted: !!grant };
}

/** Records why the person is opening a restricted record, and tells the administrators (without the patient's name). */
export async function breakGlass(db: Db, who: { practiceId: string; userId: string }, patientId: string, reason: string, now = new Date()) {
  const why = reason.trim().replace(/\s+/g, " ").slice(0, 500);
  if (why.length < 10) throw new Error("Say why you need this record, in a few words");
  const [p] = await db.select({ restricted: patients.restricted }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, who.practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  await db.insert(auditLog).values({ practiceId: who.practiceId, userId: who.userId, action: "restricted_record_opened", entity: "patient", entityId: patientId, details: { reason: why }, at: now });
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, who.userId)).limit(1);
  await notify(db, who.practiceId, { kind: "restricted_record", title: "A restricted patient record was opened", body: `By ${u?.name ?? "a team member"}. The reason is in the patient's access log.`, href: `/patients/${patientId}/access` });
}

export async function setRestricted(db: Db, practiceId: string, patientId: string, restricted: boolean, userId: string) {
  const r = await db.update(patients).set({ restricted }).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).returning();
  if (!r.length) throw new Error("Patient not found");
  await db.insert(auditLog).values({ practiceId, userId, action: restricted ? "patient_restricted" : "patient_unrestricted", entity: "patient", entityId: patientId });
}

export async function restrictedCount(db: Db, practiceId: string) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.restricted, true)));
  return Number(r?.n ?? 0);
}
