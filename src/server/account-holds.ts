/**
 * Holds that stop collection activity on a patient's balance.
 *
 *  - Bankruptcy: filing starts the automatic stay (11 U.S.C. 362), so
 *    statements, reminders, card charges, collection notices and agency
 *    placement stop. A Chapter 7 discharge wipes out what was owed for care
 *    before the filing; a dismissed case lets billing resume. The practice may
 *    file a proof of claim by the court's deadline.
 *  - Deceased patient: the patient is not billed. What is owed is a claim
 *    against the estate, filed with the executor or the probate court by the
 *    deadline in the notice to creditors (it varies by state). When the estate
 *    pays, or closes with nothing left, the rest is written off.
 *
 * A personal injury case (server/injury-cases.ts) holds a balance the same way;
 * holdReason() answers for all three.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { patientBalanceCents, patientBalanceSql } from "./billing";
import { HOLD_MESSAGE, heldPatientIds as injuryHeldIds, onInjuryHold } from "./injury-cases";

const { accountHolds, patients, appointments, ledgerEntries, auditLog } = schema;

export const HOLD_KINDS = { bankruptcy: "Bankruptcy", deceased: "Deceased patient" } as const;
export const BANKRUPTCY_MESSAGE = "The patient has filed for bankruptcy: the automatic stay stops collection activity";
export const DECEASED_MESSAGE = "The patient has died: bill the estate, not the patient";

const isDay = (v: string | undefined | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clip = (v: string | undefined | null, n: number) => v?.trim().slice(0, n) || "";

/** Why the patient's balance may not be billed or collected right now, or null. */
export async function holdReason(db: Db, patientId: string): Promise<string | null> {
  if (await onInjuryHold(db, patientId)) return HOLD_MESSAGE;
  const [h] = await db.select({ kind: accountHolds.kind }).from(accountHolds).where(and(eq(accountHolds.patientId, patientId), eq(accountHolds.status, "open"))).limit(1);
  return h ? (h.kind === "deceased" ? DECEASED_MESSAGE : BANKRUPTCY_MESSAGE) : null;
}

/** Everyone in the practice whose balance is held, for any reason. */
export async function heldPatientIds(db: Db, practiceId: string) {
  const [injury, rows] = await Promise.all([
    injuryHeldIds(db, practiceId),
    db.select({ id: accountHolds.patientId }).from(accountHolds).where(and(eq(accountHolds.practiceId, practiceId), eq(accountHolds.status, "open"))),
  ]);
  for (const r of rows) injury.add(r.id);
  return injury;
}

async function ownPatient(db: Db, practiceId: string, patientId: string) {
  const [p] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  return p;
}

async function ensureNoOpenHold(db: Db, patientId: string, kind: string) {
  const [h] = await db.select({ id: accountHolds.id }).from(accountHolds).where(and(eq(accountHolds.patientId, patientId), eq(accountHolds.kind, kind), eq(accountHolds.status, "open"))).limit(1);
  if (h) throw new Error(kind === "deceased" ? "The patient is already recorded as deceased" : "This patient already has an open bankruptcy");
}

export async function recordBankruptcy(db: Db, practiceId: string, input: { patientId: string; chapter: string; caseNumber: string; court?: string; filedOn: string; deadline?: string; notes?: string }, userId?: string) {
  await ownPatient(db, practiceId, input.patientId);
  if (!["7", "11", "13"].includes(input.chapter)) throw new Error("Choose the chapter (7, 11 or 13)");
  const caseNumber = clip(input.caseNumber, 40);
  if (!caseNumber) throw new Error("Enter the bankruptcy case number from the court's notice");
  if (!isDay(input.filedOn)) throw new Error("Enter the date the case was filed");
  if (input.deadline && !isDay(input.deadline)) throw new Error("Enter the proof of claim deadline as a date");
  await ensureNoOpenHold(db, input.patientId, "bankruptcy");
  const [row] = await db.insert(accountHolds).values({
    practiceId, patientId: input.patientId, kind: "bankruptcy", startedOn: input.filedOn, deadline: input.deadline || null,
    details: { chapter: input.chapter, caseNumber, court: clip(input.court, 120), notes: clip(input.notes, 1000) }, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "bankruptcy_recorded", entity: "patient", entityId: input.patientId, details: { holdId: row.id, chapter: input.chapter, caseNumber } });
  return row;
}

/**
 * Records a patient's death: collection activity stops, and future scheduled
 * visits are cancelled so no reminders go to the family.
 */
export async function recordDeath(db: Db, practiceId: string, input: { patientId: string; diedOn: string; executor?: string; executorAddress?: string; probateCourt?: string; deadline?: string; notes?: string }, userId?: string, now = new Date()) {
  await ownPatient(db, practiceId, input.patientId);
  if (!isDay(input.diedOn)) throw new Error("Enter the date of death");
  if (input.deadline && !isDay(input.deadline)) throw new Error("Enter the estate claim deadline as a date");
  await ensureNoOpenHold(db, input.patientId, "deceased");
  const [row] = await db.insert(accountHolds).values({
    practiceId, patientId: input.patientId, kind: "deceased", startedOn: input.diedOn, deadline: input.deadline || null,
    details: { executor: clip(input.executor, 120), executorAddress: clip(input.executorAddress, 300), probateCourt: clip(input.probateCourt, 120), notes: clip(input.notes, 1000) }, createdBy: userId ?? null,
  }).returning();
  const cancelled = await db.update(appointments).set({ status: "cancelled", cancelledAt: now })
    .where(and(eq(appointments.patientId, input.patientId), eq(appointments.status, "scheduled"), sql`${appointments.startsAt} > ${now}`)).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "death_recorded", entity: "patient", entityId: input.patientId, details: { holdId: row.id, cancelledAppointments: cancelled.length } });
  return { hold: row, cancelledAppointments: cancelled.length };
}

async function ownHold(db: Db, practiceId: string, id: string) {
  const [h] = await db.select().from(accountHolds).where(and(eq(accountHolds.id, id), eq(accountHolds.practiceId, practiceId))).limit(1);
  if (!h) throw new Error("Hold not found");
  return h;
}

/** The proof of claim (bankruptcy) or the claim against the estate was filed. */
export async function recordClaimFiled(db: Db, practiceId: string, id: string, filedOn: string, userId?: string) {
  const h = await ownHold(db, practiceId, id);
  if (h.status !== "open") throw new Error("This hold is closed");
  if (!isDay(filedOn)) throw new Error("Enter the date the claim was filed");
  await db.update(accountHolds).set({ claimFiledOn: filedOn }).where(eq(accountHolds.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "hold_claim_filed", entity: "patient", entityId: h.patientId, details: { holdId: id, filedOn } });
}

/** The balance on the day before a date: what was owed for care before a bankruptcy filing. */
async function balanceBefore(db: Db, patientId: string, day: string) {
  const r = await db.execute<{ bal: string }>(sql`SELECT (${patientBalanceSql})::bigint AS bal FROM ledger_entries WHERE patient_id = ${patientId} AND posted_at::date < ${day}`);
  return Number(r.rows[0]?.bal ?? 0);
}

export const OUTCOMES: Record<string, { kind: keyof typeof HOLD_KINDS; label: string }> = {
  discharged: { kind: "bankruptcy", label: "Discharged: what was owed before the filing is written off" },
  dismissed: { kind: "bankruptcy", label: "Dismissed or withdrawn: billing resumes" },
  estate_settled: { kind: "deceased", label: "Estate settled: post what it paid, write off the rest" },
};

/**
 * Ends a hold. A discharge writes off the balance owed before the filing (as
 * bad debt); an estate settlement posts what the estate paid and writes off
 * whatever is left; a dismissal lets normal billing resume.
 */
export async function closeHold(db: Db, practiceId: string, id: string, input: { outcome: string; paidCents?: number; method?: string }, userId?: string) {
  const h = await ownHold(db, practiceId, id);
  if (h.status !== "open") throw new Error("This hold is already closed");
  const o = OUTCOMES[input.outcome];
  if (!o || o.kind !== h.kind) throw new Error("Choose how it ended");
  const entries: (typeof ledgerEntries.$inferInsert)[] = [];
  let writtenOff = 0;
  if (input.outcome === "discharged") {
    writtenOff = Math.min(await balanceBefore(db, h.patientId, h.startedOn), await patientBalanceCents(db, h.patientId));
    if (writtenOff > 0) entries.push({ practiceId, patientId: h.patientId, type: "bad_debt", amountCents: writtenOff, note: `Discharged in bankruptcy (case ${h.details.caseNumber ?? ""})`, postedBy: userId ?? null });
  }
  if (input.outcome === "estate_settled") {
    const paid = input.paidCents ?? 0;
    if (!Number.isInteger(paid) || paid < 0) throw new Error("Enter what the estate paid");
    const balance = await patientBalanceCents(db, h.patientId);
    if (paid > 0) entries.push({ practiceId, patientId: h.patientId, type: "patient_payment", paymentMethod: "estate", amountCents: paid, note: `Paid by the estate${h.details.executor ? ` (${h.details.executor})` : ""}${input.method?.trim() ? ` (${input.method.trim().slice(0, 40)})` : ""}`, postedBy: userId ?? null });
    writtenOff = Math.max(0, balance - paid);
    if (writtenOff > 0) entries.push({ practiceId, patientId: h.patientId, type: "bad_debt", amountCents: writtenOff, note: "Estate closed: balance uncollectible", postedBy: userId ?? null });
  }
  if (entries.length) await db.insert(ledgerEntries).values(entries);
  await db.update(accountHolds).set({ status: "closed", outcome: input.outcome, closedAt: new Date() }).where(eq(accountHolds.id, id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "hold_closed", entity: "patient", entityId: h.patientId, details: { holdId: id, outcome: input.outcome, writtenOff } });
  return { writtenOffCents: writtenOff };
}

/** A hold with its patient, for the estate claim letter. */
export async function holdCase(db: Db, practiceId: string, id: string) {
  const [row] = await db.select({ h: accountHolds, p: patients }).from(accountHolds).innerJoin(patients, eq(patients.id, accountHolds.patientId))
    .where(and(eq(accountHolds.id, id), eq(accountHolds.practiceId, practiceId))).limit(1);
  return row ?? null;
}

export async function holdsFor(db: Db, patientId: string) {
  return db.select().from(accountHolds).where(eq(accountHolds.patientId, patientId)).orderBy(desc(accountHolds.createdAt));
}

export async function listHolds(db: Db, practiceId: string, status: "open" | "closed" = "open") {
  const rows = await db.select({ h: accountHolds, firstName: patients.firstName, lastName: patients.lastName, mrn: patients.mrn }).from(accountHolds)
    .innerJoin(patients, eq(patients.id, accountHolds.patientId))
    .where(and(eq(accountHolds.practiceId, practiceId), eq(accountHolds.status, status)))
    .orderBy(status === "open" ? asc(sql`COALESCE(${accountHolds.deadline}, '9999-12-31')`) : desc(accountHolds.closedAt)).limit(300);
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.h.patientId))];
  const { rows: bal } = await db.execute<{ patient_id: string; bal: string }>(sql`
    SELECT patient_id, (${patientBalanceSql})::text AS bal FROM ledger_entries
    WHERE patient_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid) GROUP BY patient_id`);
  const balances = new Map(bal.map((b) => [b.patient_id, Number(b.bal)]));
  return rows.map((r) => ({ ...r, balanceCents: balances.get(r.h.patientId) ?? 0 }));
}

/** Holds whose claim deadline is within `days` and no claim has been filed. */
export async function claimDeadlinesDue(db: Db, practiceId: string, days = 30, now = new Date()) {
  const until = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select({ id: accountHolds.id }).from(accountHolds)
    .where(and(eq(accountHolds.practiceId, practiceId), eq(accountHolds.status, "open"), sql`${accountHolds.claimFiledOn} IS NULL AND ${accountHolds.deadline} <= ${until}`));
  return rows.length;
}

/** Open holds for a set of patients, by patient (for lists that show a badge). */
export async function openHoldKinds(db: Db, patientIds: string[]) {
  if (!patientIds.length) return new Map<string, string>();
  const rows = await db.select({ patientId: accountHolds.patientId, kind: accountHolds.kind }).from(accountHolds)
    .where(and(inArray(accountHolds.patientId, patientIds), eq(accountHolds.status, "open")));
  return new Map(rows.map((r) => [r.patientId, r.kind]));
}
