/**
 * The yearly other-insurance question. Coordination of benefits denials (CARC
 * 22: "may be covered by another payer") come from coverage the practice
 * did not know about: a spouse's plan, a new job, Medicare. Asking every
 * patient once a year, at online check-in or at the desk, catches it before
 * the claim goes out. A "yes" is passed to the front desk to add the policy.
 */
import { and, asc, eq, gt, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { patients, appointments, auditLog } = schema;

export const ASK_EVERY_DAYS = 365;

/** Whether it is time to ask again: never asked, or asked more than a year ago. */
export function otherCoverageDue(checkedOn: string | null | undefined, today: string) {
  if (!checkedOn) return true;
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checkedOn}T00:00:00Z`) > ASK_EVERY_DAYS * 86_400_000;
}

export async function recordOtherCoverage(db: Db, practiceId: string, patientId: string, input: { answer: "yes" | "no"; detail?: string; on?: string; via: "checkin" | "staff" }, userId?: string) {
  if (input.answer !== "yes" && input.answer !== "no") throw new Error("Choose yes or no");
  const on = input.on && /^\d{4}-\d{2}-\d{2}$/.test(input.on) ? input.on : new Date().toISOString().slice(0, 10);
  const detail = input.answer === "yes" ? input.detail?.trim().slice(0, 300) || null : null;
  const [p] = await db.update(patients).set({ otherCoverageCheckedOn: on, otherCoverage: input.answer === "yes", otherCoverageDetail: detail })
    .where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).returning();
  if (!p) throw new Error("Patient not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "other_coverage_answered", entity: "patient", entityId: patientId, details: { answer: input.answer, via: input.via } });
}

/** Patients with a visit coming up in the next `days` days who are due to be asked, and anyone who said yes. */
export async function otherCoverageList(db: Db, practiceId: string, days = 14, now = new Date()) {
  const cutoff = new Date(now.getTime() - ASK_EVERY_DAYS * 86_400_000).toISOString().slice(0, 10);
  const until = new Date(now.getTime() + days * 86_400_000);
  const due = await db.select({ id: patients.id, mrn: patients.mrn, firstName: patients.firstName, lastName: patients.lastName, checkedOn: patients.otherCoverageCheckedOn, next: sql<string>`min(${appointments.startsAt})::text` })
    .from(patients)
    .innerJoin(appointments, and(eq(appointments.patientId, patients.id), eq(appointments.status, "scheduled"), gt(appointments.startsAt, now), lte(appointments.startsAt, until)))
    .where(and(eq(patients.practiceId, practiceId), isNull(patients.mergedInto), or(isNull(patients.otherCoverageCheckedOn), lt(patients.otherCoverageCheckedOn, cutoff))))
    .groupBy(patients.id).orderBy(sql`min(${appointments.startsAt})`).limit(300);
  const said = await db.select({ id: patients.id, mrn: patients.mrn, firstName: patients.firstName, lastName: patients.lastName, checkedOn: patients.otherCoverageCheckedOn, detail: patients.otherCoverageDetail })
    .from(patients).where(and(eq(patients.practiceId, practiceId), eq(patients.otherCoverage, true))).orderBy(asc(patients.otherCoverageCheckedOn)).limit(300);
  return { due: due.map((d) => ({ ...d, next: new Date(d.next) })), said };
}
