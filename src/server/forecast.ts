/**
 * Cash forecast: what the practice can expect to collect in each of the next
 * eight weeks, from its own history.
 *
 * Insurance: for every claim awaiting payment (and every clean claim ready to
 * send, treated as submitted today), each payer's past claims give
 * how long payment took (days from submission to first payment), how often a
 * claim was paid at all, and what fraction of the billed amount it paid. A
 * claim already N days old is projected using only past claims that took
 * longer than N days, so an old claim is not expected next week just because
 * most claims pay in three. Claims older than any paid claim in the history
 * are listed as needing follow-up instead of forecast.
 *
 * Scheduled visits: appointments on the calendar, times the share of past
 * appointments that were kept, times what a visit with that provider has
 * collected from insurance, spread by how long visits take to be paid.
 *
 * Patients: the average weekly patient payments of the last twelve weeks.
 *
 * It is an estimate from history, labeled as one; nothing here is promised.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

type Row = Record<string, string | null>;
const DAY = 86_400_000;
export const WEEKS = 8;
/** Below this many paid claims a payer's own history is too thin; the practice-wide history is used. */
const MIN_HISTORY = 20;

type History = { lags: Map<number, number>; paidCount: number; paidRatio: number };
export type PayerForecast = { payerId: string; payerName: string; openClaims: number; openCents: number; expectedCents: number; weeks: number[]; medianLagDays: number | null; payRate: number; paidRatio: number; ownHistory: boolean };
export type Forecast = {
  weekStarts: string[];
  insurance: number[];
  patient: number[];
  scheduled: number[];
  visits: { upcoming: number; keptRate: number; perVisitCents: number };
  total: number[];
  payers: PayerForecast[];
  stale: { claims: number; cents: number };
  recentActual: { weekStart: string; insurance: number; patient: number }[];
};

function history(rows: Row[]): History {
  const lags = new Map<number, number>();
  let paidCount = 0, billed = 0, paid = 0;
  for (const r of rows) {
    const n = Number(r.n);
    lags.set(Number(r.lag), (lags.get(Number(r.lag)) ?? 0) + n);
    paidCount += n; billed += Number(r.billed); paid += Number(r.paid);
  }
  return { lags, paidCount, paidRatio: billed ? Math.min(1, paid / billed) : 0 };
}

function median(lags: Map<number, number>) {
  const total = [...lags.values()].reduce((a, n) => a + n, 0);
  if (!total) return null;
  let seen = 0;
  for (const lag of [...lags.keys()].sort((a, b) => a - b)) {
    seen += lags.get(lag)!;
    if (seen >= total / 2) return lag;
  }
  return null;
}

/**
 * Spreads one group of claims (same payer, same age) across the weeks ahead.
 * Returns the expected cents per week, or null when no past claim took this long.
 */
export function project(h: History, payRate: number, ageDays: number, amountCents: number): number[] | null {
  let later = 0;
  const weeks = Array(WEEKS).fill(0) as number[];
  for (const [lag, n] of h.lags) {
    if (lag <= ageDays) continue;
    later += n;
    const w = Math.floor((lag - ageDays - 1) / 7);
    if (w < WEEKS) weeks[w] += n;
  }
  if (!later) return null;
  // Probability of eventual payment, given the claim is still unpaid at this age.
  const survivors = h.paidCount ? later / h.paidCount : 0;
  const pPaid = (payRate * survivors) / (payRate * survivors + (1 - payRate) || 1);
  return weeks.map((n) => (amountCents * h.paidRatio * pPaid * n) / later);
}

export async function cashForecast(db: Db, practiceId: string, now = new Date()): Promise<Forecast> {
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const ninetyAgo = new Date(now.getTime() - 90 * DAY);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const [{ rows: lagRows }, { rows: rateRows }, { rows: openRows }, { rows: weekly }, { rows: payerNames }] = await Promise.all([
    db.execute<Row>(sql`
      SELECT c.payer_id, GREATEST(0, fp.paid_at::date - c.submitted_at::date)::text AS lag, count(*)::text AS n, sum(c.total_cents)::text AS billed, sum(fp.paid)::text AS paid
      FROM claims c
      JOIN (SELECT claim_id, min(posted_at) AS paid_at, sum(amount_cents) AS paid FROM ledger_entries WHERE practice_id = ${practiceId} AND type = 'insurance_payment' GROUP BY claim_id) fp ON fp.claim_id = c.id
      WHERE c.practice_id = ${practiceId} AND c.submitted_at >= ${yearAgo} AND c.frequency_code = '1'
      GROUP BY 1, 2`),
    db.execute<Row>(sql`
      SELECT c.payer_id, count(*)::text AS decided, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ledger_entries l WHERE l.claim_id = c.id AND l.type = 'insurance_payment'))::text AS paid
      FROM claims c
      WHERE c.practice_id = ${practiceId} AND c.submitted_at >= ${yearAgo} AND c.submitted_at < ${ninetyAgo} AND c.frequency_code = '1' AND c.status NOT IN ('voided', 'draft')
      GROUP BY 1`),
    db.execute<Row>(sql`
      SELECT c.payer_id, GREATEST(0, ${today.toISOString().slice(0, 10)}::date - COALESCE(c.submitted_at::date, ${today.toISOString().slice(0, 10)}::date))::text AS age, count(*)::text AS n, sum(c.total_cents)::text AS cents
      FROM claims c
      WHERE c.practice_id = ${practiceId} AND c.status IN ('ready', 'submitted', 'accepted', 'pending')
        AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.claim_id = c.id AND l.type = 'insurance_payment')
      GROUP BY 1, 2`),
    db.execute<Row>(sql`
      SELECT floor(extract(epoch FROM (${today}::timestamptz - date_trunc('day', posted_at))) / 604800)::int::text AS ago,
        COALESCE(sum(amount_cents) FILTER (WHERE type = 'insurance_payment'), 0)::text AS ins,
        COALESCE(sum(amount_cents) FILTER (WHERE type = 'patient_payment'), 0)::text AS pat
      FROM ledger_entries
      WHERE practice_id = ${practiceId} AND type IN ('insurance_payment', 'patient_payment') AND posted_at >= ${new Date(today.getTime() - 12 * 7 * DAY)} AND posted_at < ${today}
      GROUP BY 1`),
    db.execute<Row>(sql`SELECT id, name FROM payers WHERE practice_id = ${practiceId}`),
  ]);
  const todayIso = today.toISOString().slice(0, 10);
  const [{ rows: upcoming }, { rows: kept }, { rows: perVisit }, { rows: visitLags }] = await Promise.all([
    db.execute<Row>(sql`
      SELECT provider_id, (starts_at::date - ${todayIso}::date)::text AS day, count(*)::text AS n
      FROM appointments WHERE practice_id = ${practiceId} AND status IN ('scheduled', 'checked_in') AND starts_at >= ${today} AND starts_at < ${new Date(today.getTime() + WEEKS * 7 * DAY)}
      GROUP BY 1, 2`),
    db.execute<Row>(sql`
      SELECT count(*) FILTER (WHERE status IN ('completed', 'checked_in'))::text AS kept, count(*)::text AS n
      FROM appointments WHERE practice_id = ${practiceId} AND status IN ('completed', 'checked_in', 'no_show', 'cancelled') AND starts_at >= ${ninetyAgo} AND starts_at < ${today}`),
    // Matured visits only (seen 60 to 240 days ago), so recent claims still in flight do not drag the average down.
    db.execute<Row>(sql`
      SELECT e.provider_id, count(*)::text AS n, COALESCE(sum(p.paid), 0)::text AS paid
      FROM claims c JOIN encounters e ON e.id = c.encounter_id
      LEFT JOIN (SELECT claim_id, sum(amount_cents) AS paid FROM ledger_entries WHERE practice_id = ${practiceId} AND type = 'insurance_payment' GROUP BY 1) p ON p.claim_id = c.id
      WHERE c.practice_id = ${practiceId} AND c.frequency_code = '1' AND c.payer_sequence = 'P'
        AND e.date_of_service >= ${new Date(today.getTime() - 240 * DAY).toISOString().slice(0, 10)} AND e.date_of_service < ${new Date(today.getTime() - 60 * DAY).toISOString().slice(0, 10)}
      GROUP BY 1`),
    db.execute<Row>(sql`
      SELECT GREATEST(0, fp.paid_at::date - e.date_of_service)::text AS lag, count(*)::text AS n
      FROM claims c JOIN encounters e ON e.id = c.encounter_id
      JOIN (SELECT claim_id, min(posted_at) AS paid_at FROM ledger_entries WHERE practice_id = ${practiceId} AND type = 'insurance_payment' GROUP BY 1) fp ON fp.claim_id = c.id
      WHERE c.practice_id = ${practiceId} AND c.frequency_code = '1' AND e.date_of_service >= ${yearAgo.toISOString().slice(0, 10)}
      GROUP BY 1`),
  ]);

  const byPayer = new Map<string, Row[]>();
  for (const r of lagRows) byPayer.set(r.payer_id!, [...(byPayer.get(r.payer_id!) ?? []), r]);
  const all = history(lagRows);
  const rates = new Map(rateRows.map((r) => [r.payer_id!, { decided: Number(r.decided), paid: Number(r.paid) }]));
  const totalRate = [...rates.values()].reduce((a, r) => ({ decided: a.decided + r.decided, paid: a.paid + r.paid }), { decided: 0, paid: 0 });
  const allRate = totalRate.decided ? totalRate.paid / totalRate.decided : 0.9;
  const names = new Map(payerNames.map((p) => [p.id!, p.name!]));

  const insurance = Array(WEEKS).fill(0) as number[];
  const stale = { claims: 0, cents: 0 };
  const payerOut = new Map<string, PayerForecast>();
  for (const r of openRows) {
    const pid = r.payer_id!;
    const own = history(byPayer.get(pid) ?? []);
    const ownHistory = own.paidCount >= MIN_HISTORY;
    const h = ownHistory ? own : all;
    const rate = rates.get(pid);
    const payRate = ownHistory && rate && rate.decided >= MIN_HISTORY ? rate.paid / rate.decided : allRate;
    const n = Number(r.n), cents = Number(r.cents);
    const p = payerOut.get(pid) ?? { payerId: pid, payerName: names.get(pid) ?? "Unknown payer", openClaims: 0, openCents: 0, expectedCents: 0, weeks: Array(WEEKS).fill(0), medianLagDays: median(h.lags), payRate, paidRatio: h.paidRatio, ownHistory };
    p.openClaims += n; p.openCents += cents;
    const weeks = project(h, payRate, Number(r.age), cents);
    if (!weeks) { stale.claims += n; stale.cents += cents; }
    else weeks.forEach((c, i) => { p.weeks[i] += c; insurance[i] += c; p.expectedCents += c; });
    payerOut.set(pid, p);
  }

  // Scheduled visits: kept rate x collections per visit, spread over the weeks by the visit-to-payment lag.
  const keptRate = Number(kept[0]?.n) ? Number(kept[0].kept) / Number(kept[0].n) : 0;
  const provider = new Map(perVisit.map((r) => [r.provider_id!, Number(r.paid) / Math.max(1, Number(r.n))]));
  const allVisits = perVisit.reduce((a, r) => ({ n: a.n + Number(r.n), paid: a.paid + Number(r.paid) }), { n: 0, paid: 0 });
  const practiceVisit = allVisits.n ? allVisits.paid / allVisits.n : 0;
  const lagTotal = visitLags.reduce((a, r) => a + Number(r.n), 0);
  const scheduled = Array(WEEKS).fill(0) as number[];
  let upcomingCount = 0;
  for (const a of upcoming) {
    const n = Number(a.n), day = Number(a.day);
    upcomingCount += n;
    const value = n * keptRate * (provider.get(a.provider_id!) ?? practiceVisit);
    if (!lagTotal || !value) continue;
    for (const l of visitLags) {
      const w = Math.floor((day + Number(l.lag)) / 7);
      if (w < WEEKS) scheduled[w] += (value * Number(l.n)) / lagTotal;
    }
  }

  const recent = new Map(weekly.map((w) => [Number(w.ago), { ins: Number(w.ins), pat: Number(w.pat) }]));
  const patientWeekly = Math.round([...recent.values()].reduce((a, w) => a + w.pat, 0) / 12);
  const patient = Array(WEEKS).fill(patientWeekly) as number[];
  const round = (xs: number[]) => xs.map((x) => Math.round(x));
  const ins = round(insurance);
  const sched = round(scheduled);
  return {
    weekStarts: Array.from({ length: WEEKS }, (_, i) => new Date(today.getTime() + i * 7 * DAY).toISOString().slice(0, 10)),
    insurance: ins,
    patient,
    scheduled: sched,
    visits: { upcoming: upcomingCount, keptRate, perVisitCents: Math.round(practiceVisit) },
    total: ins.map((c, i) => c + patient[i] + sched[i]),
    payers: [...payerOut.values()].map((p) => ({ ...p, expectedCents: Math.round(p.expectedCents), weeks: round(p.weeks) })).sort((a, b) => b.expectedCents - a.expectedCents),
    stale,
    recentActual: Array.from({ length: 8 }, (_, i) => 7 - i).map((ago) => ({
      weekStart: new Date(today.getTime() - (ago + 1) * 7 * DAY).toISOString().slice(0, 10),
      insurance: recent.get(ago)?.ins ?? 0,
      patient: recent.get(ago)?.pat ?? 0,
    })),
  };
}
