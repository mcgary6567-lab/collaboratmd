/**
 * Language access. Practices that take federal money (Medicare Part A,
 * Medicaid, ACA plans) must offer free, qualified interpreters to patients
 * with limited English proficiency (Section 1557 of the Affordable Care Act,
 * 45 CFR 92.201), and should not rely on family members or minor children
 * except in limited cases. The practice records which patients need an
 * interpreter and each time one was provided (or offered and declined), with
 * the vendor, minutes and cost.
 *
 * Some state Medicaid programs pay for interpreter services under HCPCS T1013
 * (per 15 minutes; rules vary by state). With the practice's T1013 policy on,
 * Medicaid visits show the units to bill.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { interpreterServices, patients, patientInsurances, payers, auditLog } = schema;

export const MODES: Record<string, string> = { in_person: "In person", phone: "Phone", video: "Video", staff: "Qualified bilingual staff" };

/** T1013 units for a session: one per 15 minutes or part of it. */
export const t1013Units = (minutes: number) => Math.max(1, Math.ceil(minutes / 15));

export async function setInterpreterLanguage(db: Db, practiceId: string, patientId: string, language: string, userId?: string) {
  const lang = language.trim().slice(0, 60) || null;
  const [p] = await db.update(patients).set({ interpreterLanguage: lang }).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).returning();
  if (!p) throw new Error("Patient not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "interpreter_language_set", entity: "patient", entityId: patientId, details: { language: lang } });
}

export async function logInterpreter(db: Db, practiceId: string, input: { patientId: string; servedOn: string; language?: string; mode: string; vendor?: string; minutes: number; costCents?: number | null; declined?: boolean; notes?: string; appointmentId?: string | null }, userId?: string) {
  const [p] = await db.select().from(patients).where(and(eq(patients.id, input.patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.servedOn)) throw new Error("Enter the date");
  const language = (input.language?.trim() || p.interpreterLanguage || "").slice(0, 60);
  if (!language) throw new Error("Enter the language");
  if (!MODES[input.mode]) throw new Error("Choose how the interpreter was provided");
  if (!input.declined && (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 600)) throw new Error("Enter the minutes, 1 to 600");
  if (input.costCents !== null && input.costCents !== undefined && (!Number.isInteger(input.costCents) || input.costCents < 0)) throw new Error("Enter the cost in dollars");
  const [row] = await db.insert(interpreterServices).values({
    practiceId, patientId: p.id, appointmentId: input.appointmentId ?? null, servedOn: input.servedOn, language, mode: input.mode,
    vendor: input.vendor?.trim().slice(0, 120) || null, minutes: input.declined ? 0 : input.minutes, costCents: input.costCents ?? null,
    declined: !!input.declined, notes: input.notes?.trim().slice(0, 500) || null, createdBy: userId ?? null,
  }).returning();
  if (!p.interpreterLanguage) await db.update(patients).set({ interpreterLanguage: language }).where(eq(patients.id, p.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "interpreter_logged", entity: "patient", entityId: p.id, details: { id: row.id, language, declined: !!input.declined } });
  return row;
}

/** Sessions in a period, with totals by language and vendor and, for Medicaid patients, T1013 units. */
export async function interpreterReport(db: Db, practiceId: string, from: string, to: string) {
  const rows = await db.select({ s: interpreterServices, firstName: patients.firstName, lastName: patients.lastName, medicaid: sql<boolean>`EXISTS (
      SELECT 1 FROM ${patientInsurances} pi JOIN ${payers} py ON py.id = pi.payer_id WHERE pi.patient_id = ${patients.id} AND pi.active AND py.type = 'medicaid')` })
    .from(interpreterServices).innerJoin(patients, eq(patients.id, interpreterServices.patientId))
    .where(and(eq(interpreterServices.practiceId, practiceId), sql`${interpreterServices.servedOn} BETWEEN ${from} AND ${to}`))
    .orderBy(desc(interpreterServices.servedOn)).limit(1000);
  const sessions = rows.map((r) => ({ ...r, medicaid: r.medicaid === true || (r.medicaid as unknown) === "t", units: r.s.declined ? 0 : t1013Units(r.s.minutes) }));
  const sum = (key: (x: (typeof sessions)[number]) => string) => {
    const m = new Map<string, { sessions: number; minutes: number; costCents: number }>();
    for (const x of sessions.filter((y) => !y.s.declined)) {
      const t = m.get(key(x)) ?? { sessions: 0, minutes: 0, costCents: 0 };
      t.sessions++; t.minutes += x.s.minutes; t.costCents += x.s.costCents ?? 0;
      m.set(key(x), t);
    }
    return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.sessions - a.sessions);
  };
  return {
    sessions,
    byLanguage: sum((x) => x.s.language),
    byVendor: sum((x) => x.s.vendor ?? MODES[x.s.mode]),
    declined: sessions.filter((x) => x.s.declined).length,
    medicaidUnits: sessions.filter((x) => x.medicaid && !x.s.declined).reduce((a, x) => a + x.units, 0),
  };
}

/** Patients who need an interpreter and have a visit in the next `days` days, so one can be booked. */
export async function upcomingInterpreterNeeds(db: Db, practiceId: string, days = 7, now = new Date()) {
  const until = new Date(now.getTime() + days * 86_400_000);
  const { rows } = await db.execute<Record<string, string | null>>(sql`
    SELECT p.id, p.first_name, p.last_name, p.interpreter_language, a.id AS appointment_id, a.starts_at::text AS starts_at
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.practice_id = ${practiceId} AND a.status = 'scheduled' AND a.starts_at > ${now} AND a.starts_at <= ${until} AND p.interpreter_language IS NOT NULL
    ORDER BY a.starts_at`);
  return rows.map((r) => ({ patientId: r.id!, name: `${r.last_name}, ${r.first_name}`, language: r.interpreter_language!, appointmentId: r.appointment_id!, startsAt: new Date(r.starts_at!) }));
}
