/**
 * The front desk's end of day. Payments posted that day (in the practice's
 * time zone) are totaled by method; the desk counts the cash and checks in the
 * drawer and reads the card terminal's batch total; any difference is a
 * variance to explain before the deposit goes to the bank. Online, card-on-file
 * and agency payments never pass through the desk, so they are listed but not
 * counted.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { practiceTimeZone } from "./practice-time";

const { cashCloses, auditLog } = schema;

export const DESK_METHODS = ["cash", "check", "card"] as const;
export const METHOD_LABEL: Record<string, string> = {
  cash: "Cash", check: "Checks", card: "Cards at the desk", ach: "Bank transfers (ACH)", online: "Online (portal)", card_on_file: "Card on file", terminal: "Card terminal",
  agency: "Collection agency", settlement: "Injury settlements", other: "Other",
};

/** A payment's method: recorded from migration 0064 on, read from the note before that. */
const methodSql = sql`COALESCE(le.payment_method,
  CASE WHEN le.note ILIKE '%(cash)%' THEN 'cash' WHEN le.note ILIKE '%(check)%' THEN 'check' WHEN le.note ILIKE '%(ach)%' THEN 'ach'
       WHEN le.note ILIKE 'Online%' THEN 'online' WHEN le.note ILIKE 'Card on file%' THEN 'card_on_file' WHEN le.note ILIKE 'Collected by%' THEN 'agency'
       WHEN le.note ILIKE '%(card%' THEN 'card' ELSE 'other' END)`;

/** Payments posted on a day in the practice's time zone, by method. Card-terminal payments count with the desk's cards. */
export async function dayTotals(db: Db, practiceId: string, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Choose a day");
  const tz = await practiceTimeZone(db, practiceId);
  const { rows } = await db.execute<{ method: string; cents: string; n: string }>(sql`
    SELECT ${methodSql} AS method, sum(le.amount_cents)::text AS cents, count(*)::text AS n
    FROM ledger_entries le
    WHERE le.practice_id = ${practiceId} AND le.type = 'patient_payment' AND (le.posted_at AT TIME ZONE ${tz})::date = ${day}
    GROUP BY 1`);
  const totals: Record<string, number> = {};
  for (const r of rows) {
    const m = r.method === "terminal" ? "card" : r.method;
    totals[m] = (totals[m] ?? 0) + Number(r.cents);
  }
  return totals;
}

export async function closeDay(db: Db, practiceId: string, input: { day: string; countedCashCents: number; countedChecksCents: number; cardBatchCents: number; depositReference?: string; notes?: string }, userId?: string) {
  for (const v of [input.countedCashCents, input.countedChecksCents, input.cardBatchCents]) if (!Number.isInteger(v) || v < 0) throw new Error("Enter the counted amounts in dollars");
  const expected = await dayTotals(db, practiceId, input.day);
  const variance = varianceOf(expected, input);
  const notes = input.notes?.trim().slice(0, 1000) || null;
  if (Object.values(variance).some((v) => v !== 0) && !notes) throw new Error("There is a difference: explain it in the notes before closing the day");
  const values = { practiceId, day: input.day, expected, countedCashCents: input.countedCashCents, countedChecksCents: input.countedChecksCents, cardBatchCents: input.cardBatchCents, depositReference: input.depositReference?.trim().slice(0, 80) || null, notes, closedBy: userId ?? null };
  const [existing] = await db.select({ id: cashCloses.id }).from(cashCloses).where(and(eq(cashCloses.practiceId, practiceId), eq(cashCloses.day, input.day))).limit(1);
  if (existing) await db.update(cashCloses).set({ ...values, closedAt: new Date() }).where(eq(cashCloses.id, existing.id));
  else await db.insert(cashCloses).values(values);
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "cash_day_closed", entity: "practice", entityId: practiceId, details: { day: input.day, variance } });
  return { expected, variance };
}

export function varianceOf(expected: Record<string, number>, counted: { countedCashCents: number; countedChecksCents: number; cardBatchCents: number }) {
  return {
    cash: counted.countedCashCents - (expected.cash ?? 0),
    check: counted.countedChecksCents - (expected.check ?? 0),
    card: counted.cardBatchCents - (expected.card ?? 0),
  };
}

export async function recentCloses(db: Db, practiceId: string, limit = 30) {
  const rows = await db.select().from(cashCloses).where(eq(cashCloses.practiceId, practiceId)).orderBy(desc(cashCloses.day)).limit(limit);
  return rows.map((r) => ({ ...r, variance: varianceOf(r.expected, r) }));
}
