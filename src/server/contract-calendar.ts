/**
 * Payer contract calendar: when each contract renews, the last day to give
 * notice to renegotiate or end it, any scheduled increase, and how much each
 * payer underpaid in the last year, so the contracts worth renegotiating come
 * first. Administrators are reminded 60, 30 and 7 days before a notice date.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notify } from "./notifications";

const { feeSchedules, auditLog } = schema;
type Row = Record<string, string | null>;

const isDay = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export async function saveContractDates(db: Db, practiceId: string, scheduleId: string, input: { renewsOn: string; noticeDays: string; escalatorPct: string; termsNotes: string }, userId?: string) {
  const renewsOn = input.renewsOn.trim() || null;
  if (renewsOn && !isDay(renewsOn)) throw new Error("Enter the renewal date");
  const noticeDays = input.noticeDays.trim() ? Number(input.noticeDays) : null;
  if (noticeDays !== null && (!Number.isInteger(noticeDays) || noticeDays < 0 || noticeDays > 365)) throw new Error("Notice is 0 to 365 days");
  const escalatorPct = input.escalatorPct.trim() ? Number(input.escalatorPct) : null;
  if (escalatorPct !== null && (!Number.isFinite(escalatorPct) || escalatorPct < -50 || escalatorPct > 50)) throw new Error("The scheduled increase is -50% to 50%");
  const [row] = await db.update(feeSchedules).set({ renewsOn, noticeDays, escalatorPct, termsNotes: input.termsNotes.trim().slice(0, 1000) || null })
    .where(and(eq(feeSchedules.id, scheduleId), eq(feeSchedules.practiceId, practiceId), isNotNull(feeSchedules.payerId))).returning();
  if (!row) throw new Error("Payer contract not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "contract_dates_saved", entity: "fee_schedule", entityId: scheduleId, details: { renewsOn, noticeDays, escalatorPct } });
  return row;
}

export type ContractDate = {
  scheduleId: string; name: string; payerId: string; payerName: string;
  renewsOn: string | null; noticeDays: number | null; noticeBy: string | null; daysToNotice: number | null; escalatorPct: number | null; termsNotes: string | null;
  underpaidCents: number; underpaidClaims: number; allowedCents: number;
};

export async function contractCalendar(db: Db, practiceId: string, today = new Date().toISOString().slice(0, 10)): Promise<ContractDate[]> {
  const since = addDays(today, -365);
  const { rows } = await db.execute<Row>(sql`
    SELECT fs.id, fs.name, fs.payer_id, py.name AS payer, fs.renews_on::text AS renews_on, fs.notice_days::text AS notice_days, fs.escalator_pct::text AS escalator_pct, fs.terms_notes,
      COALESCE((SELECT sum(u.variance_cents) FROM underpayments u WHERE u.practice_id = ${practiceId} AND u.payer_id = fs.payer_id AND u.detected_at >= ${since}::date), 0)::text AS underpaid,
      COALESCE((SELECT count(*) FROM underpayments u WHERE u.practice_id = ${practiceId} AND u.payer_id = fs.payer_id AND u.detected_at >= ${since}::date), 0)::text AS underpaid_claims,
      COALESCE((SELECT sum(rl.allowed_cents) FROM remittance_lines rl WHERE rl.practice_id = ${practiceId} AND rl.payer_id = fs.payer_id AND rl.payment_date >= ${since}::date), 0)::text AS allowed
    FROM fee_schedules fs JOIN payers py ON py.id = fs.payer_id
    WHERE fs.practice_id = ${practiceId} AND fs.payer_id IS NOT NULL AND fs.active`);
  const out = rows.map((r): ContractDate => {
    const noticeDays = r.notice_days === null ? null : Number(r.notice_days);
    const noticeBy = r.renews_on ? addDays(r.renews_on, -(noticeDays ?? 0)) : null;
    return {
      scheduleId: r.id!, name: r.name!, payerId: r.payer_id!, payerName: r.payer!, renewsOn: r.renews_on, noticeDays, noticeBy,
      daysToNotice: noticeBy ? daysBetween(today, noticeBy) : null, escalatorPct: r.escalator_pct === null ? null : Number(r.escalator_pct), termsNotes: r.terms_notes,
      underpaidCents: Math.max(0, Number(r.underpaid)), underpaidClaims: Number(r.underpaid_claims), allowedCents: Number(r.allowed),
    };
  });
  // Coming notice dates first (soonest first), then contracts without dates, most underpaid first.
  return out.sort((a, b) => {
    const au = a.daysToNotice !== null && a.daysToNotice >= 0, bu = b.daysToNotice !== null && b.daysToNotice >= 0;
    if (au !== bu) return au ? -1 : 1;
    if (au && bu) return a.daysToNotice! - b.daysToNotice!;
    return b.underpaidCents - a.underpaidCents;
  });
}

/** Reminders to administrators 60, 30 and 7 days before a contract's notice date (once each). */
export async function contractReminders(db: Db, practiceId: string, today = new Date().toISOString().slice(0, 10)) {
  let sent = 0;
  for (const c of await contractCalendar(db, practiceId, today)) {
    if (c.daysToNotice === null || c.daysToNotice < 0 || c.daysToNotice > 60) continue;
    const step = c.daysToNotice <= 7 ? 7 : c.daysToNotice <= 30 ? 30 : 60;
    await notify(db, practiceId, {
      kind: "contract_notice", title: `${c.payerName} contract: notice due ${c.noticeBy} (${c.daysToNotice} day${c.daysToNotice === 1 ? "" : "s"})`,
      body: `The contract renews ${c.renewsOn}. To renegotiate or end it, give notice by ${c.noticeBy}.${c.underpaidCents ? ` Underpaid in the last year: $${(c.underpaidCents / 100).toFixed(2)} on ${c.underpaidClaims} claims.` : ""}`,
      href: "/reports/contract-calendar", dedupeKey: `contract_notice:${c.scheduleId}:${c.noticeBy}:${step}`,
    });
    sent++;
  }
  return sent;
}
