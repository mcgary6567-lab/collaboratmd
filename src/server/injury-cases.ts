/**
 * Personal injury cases. When a patient hurt in an accident is represented by
 * an attorney, the practice often agrees to wait for the settlement under a
 * lien or letter of protection instead of billing the patient. While the case
 * is open the patient's balance is held: no statements, reminders, card
 * charges or collections. The attorney may ask for a reduction; what is agreed
 * is posted as a discount when the settlement is paid.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { patientBalanceCents, patientBalanceSql } from "./billing";

const { injuryCases, patients, ledgerEntries, auditLog } = schema;
const isDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export const HOLD_MESSAGE = "This patient's balance is held for a personal injury case until it settles";

/** Whether an open personal injury case holds this patient's balance. */
export async function onInjuryHold(db: Db, patientId: string) {
  const [c] = await db.select({ id: injuryCases.id }).from(injuryCases).where(and(eq(injuryCases.patientId, patientId), eq(injuryCases.status, "open"))).limit(1);
  return !!c;
}

export async function heldPatientIds(db: Db, practiceId: string) {
  const rows = await db.select({ id: injuryCases.patientId }).from(injuryCases).where(and(eq(injuryCases.practiceId, practiceId), eq(injuryCases.status, "open")));
  return new Set(rows.map((r) => r.id));
}

export async function openInjuryCase(db: Db, practiceId: string, input: { patientId: string; attorney: string; firm?: string; phone?: string; email?: string; caseNumber?: string; accidentOn?: string; lienSignedOn: string; notes?: string }, userId?: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  const attorney = input.attorney.trim().slice(0, 120);
  if (!attorney) throw new Error("Enter the attorney's name");
  if (!isDay(input.lienSignedOn)) throw new Error("Enter the date the lien or letter of protection was signed");
  if (input.accidentOn && !isDay(input.accidentOn)) throw new Error("Enter the accident date as a date");
  if (await onInjuryHold(db, input.patientId)) throw new Error("This patient already has an open case");
  const [row] = await db.insert(injuryCases).values({
    practiceId, patientId: input.patientId, attorney, firm: input.firm?.trim().slice(0, 120) || null, phone: input.phone?.trim().slice(0, 30) || null, email: input.email?.trim().slice(0, 200) || null,
    caseNumber: input.caseNumber?.trim().slice(0, 60) || null, accidentOn: input.accidentOn || null, lienSignedOn: input.lienSignedOn, notes: input.notes?.trim().slice(0, 1000) || null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "injury_case_opened", entity: "patient", entityId: input.patientId, details: { caseId: row.id, attorney } });
  return row;
}

async function ownCase(db: Db, practiceId: string, id: string) {
  const [c] = await db.select().from(injuryCases).where(and(eq(injuryCases.id, id), eq(injuryCases.practiceId, practiceId))).limit(1);
  if (!c) throw new Error("Case not found");
  return c;
}

export async function recordReduction(db: Db, practiceId: string, id: string, input: { requestedCents?: number | null; agreedCents?: number | null }, userId?: string) {
  const c = await ownCase(db, practiceId, id);
  if (c.status !== "open") throw new Error("The case is closed");
  for (const v of [input.requestedCents, input.agreedCents]) if (v !== undefined && v !== null && (!Number.isInteger(v) || v < 0)) throw new Error("Enter amounts in dollars");
  const balance = await patientBalanceCents(db, c.patientId);
  if (input.agreedCents && input.agreedCents > balance) throw new Error("The reduction cannot be more than the balance");
  await db.update(injuryCases).set({
    reductionRequestedCents: input.requestedCents ?? c.reductionRequestedCents, reductionAgreedCents: input.agreedCents ?? c.reductionAgreedCents,
  }).where(eq(injuryCases.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "injury_reduction", entity: "patient", entityId: c.patientId, details: { caseId: id, ...input } });
}

/**
 * The settlement check arrived: the payment posts to the patient's account,
 * and the agreed reduction (if any) as a discount. The case closes and normal
 * billing resumes for anything still owed.
 */
export async function settleInjuryCase(db: Db, practiceId: string, id: string, input: { settledOn: string; paidCents: number; method: string }, userId?: string) {
  const c = await ownCase(db, practiceId, id);
  if (c.status !== "open") throw new Error("The case is already closed");
  if (!isDay(input.settledOn)) throw new Error("Enter the settlement date");
  if (!Number.isInteger(input.paidCents) || input.paidCents < 0) throw new Error("Enter the amount the attorney paid");
  const entries: (typeof ledgerEntries.$inferInsert)[] = [];
  if (input.paidCents > 0) entries.push({ practiceId, patientId: c.patientId, type: "patient_payment", paymentMethod: "settlement", amountCents: input.paidCents, note: `Personal injury settlement from ${c.attorney}${c.firm ? `, ${c.firm}` : ""} (${input.method.trim().slice(0, 40) || "check"})`, postedBy: userId ?? null });
  if (c.reductionAgreedCents) entries.push({ practiceId, patientId: c.patientId, type: "discount", amountCents: c.reductionAgreedCents, note: `Lien reduction agreed with ${c.attorney}`, postedBy: userId ?? null });
  if (entries.length) await db.insert(ledgerEntries).values(entries);
  await db.update(injuryCases).set({ status: "settled", settledOn: input.settledOn, settlementPaidCents: input.paidCents }).where(eq(injuryCases.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "injury_case_settled", entity: "patient", entityId: c.patientId, details: { caseId: id, paidCents: input.paidCents, reductionCents: c.reductionAgreedCents } });
  return { balanceCents: await patientBalanceCents(db, c.patientId) };
}

/** The case ended without a settlement to the practice (dropped, lost): normal billing resumes. */
export async function dropInjuryCase(db: Db, practiceId: string, id: string, reason: string, userId?: string) {
  const c = await ownCase(db, practiceId, id);
  if (c.status !== "open") throw new Error("The case is already closed");
  const why = reason.trim().slice(0, 500);
  if (!why) throw new Error("Say why the case closed without a settlement");
  await db.update(injuryCases).set({ status: "dropped", notes: [c.notes, `Closed: ${why}`].filter(Boolean).join("\n") }).where(eq(injuryCases.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "injury_case_dropped", entity: "patient", entityId: c.patientId, details: { caseId: id, reason: why } });
}

export async function listInjuryCases(db: Db, practiceId: string, status: "open" | "closed" = "open") {
  const rows = await db.select({ c: injuryCases, firstName: patients.firstName, lastName: patients.lastName, mrn: patients.mrn }).from(injuryCases)
    .innerJoin(patients, eq(patients.id, injuryCases.patientId))
    .where(and(eq(injuryCases.practiceId, practiceId), status === "open" ? eq(injuryCases.status, "open") : inArray(injuryCases.status, ["settled", "dropped"])))
    .orderBy(status === "open" ? injuryCases.lienSignedOn : desc(injuryCases.settledOn)).limit(300);
  if (!rows.length) return [];
  const { rows: bal } = await db.execute<{ patient_id: string; bal: string }>(sql`
    SELECT patient_id, (${patientBalanceSql})::text AS bal
    FROM ledger_entries WHERE patient_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(rows.map((r) => r.c.patientId))}::jsonb)::uuid) GROUP BY patient_id`);
  const balances = new Map(bal.map((b) => [b.patient_id, Number(b.bal)]));
  return rows.map((r) => ({ ...r, balanceCents: balances.get(r.c.patientId) ?? 0 }));
}
