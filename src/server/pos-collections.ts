/**
 * Time-of-service collections: what the front desk could have collected at
 * each visit (the copay on the patient's primary insurance, and any balance
 * owed before that day) against what was actually collected that day. A
 * payment counts toward the copay first, then the prior balance. Payments
 * the desk did not take (card-on-file charges, agency, settlement and estate
 * payments) are left out; online check-in payments count.
 *
 * The copay is today's copay on file, so a visit from before a plan change
 * uses the new amount.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { patientBalanceSql } from "./billing";
import { practiceTimeZone } from "./practice-time";

type Row = Record<string, string | null>;
const NOT_DESK = sql`('agency', 'settlement', 'estate', 'card_on_file')`;

export type Tally = { visits: number; copayDueCents: number; copayCollectedCents: number; priorDueCents: number; priorCollectedCents: number; collectedCents: number };
const empty = (): Tally => ({ visits: 0, copayDueCents: 0, copayCollectedCents: 0, priorDueCents: 0, priorCollectedCents: 0, collectedCents: 0 });

/** The Monday of the week a day (YYYY-MM-DD) falls in. */
export function weekOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Splits what was collected at a visit between the copay and the prior balance. */
export function applyCollected(copayDue: number, priorDue: number, collected: number) {
  const copay = Math.min(collected, copayDue);
  const prior = Math.min(collected - copay, priorDue);
  return { copay, prior };
}

export async function frontDeskCollections(db: Db, practiceId: string, from: string, to: string) {
  const tz = await practiceTimeZone(db, practiceId);
  const { rows } = await db.execute<Row>(sql`
    WITH seen AS (
      SELECT a.patient_id, a.starts_at, a.location_id, (a.starts_at AT TIME ZONE ${tz})::date AS day
      FROM appointments a
      WHERE a.practice_id = ${practiceId} AND a.status IN ('checked_in', 'completed')
        AND a.starts_at >= (${from}::date - 2) AND a.starts_at < (${to}::date + 2)
    ), v AS (
      SELECT DISTINCT ON (s.patient_id, s.day) s.patient_id, s.day, COALESCE(l.name, 'No location') AS location
      FROM seen s LEFT JOIN locations l ON l.id = s.location_id
      WHERE s.day BETWEEN ${from} AND ${to}
      ORDER BY s.patient_id, s.day, s.starts_at
    )
    SELECT v.patient_id, v.day::text AS day, v.location,
      COALESCE((SELECT pi.copay_cents FROM patient_insurances pi WHERE pi.patient_id = v.patient_id AND pi.active ORDER BY pi.rank LIMIT 1), 0)::text AS copay,
      GREATEST(0, COALESCE((SELECT (${patientBalanceSql}) FROM ledger_entries WHERE patient_id = v.patient_id AND (posted_at AT TIME ZONE ${tz})::date < v.day), 0))::text AS prior,
      COALESCE((SELECT sum(le.amount_cents) FROM ledger_entries le WHERE le.patient_id = v.patient_id AND le.type = 'patient_payment'
        AND (le.posted_at AT TIME ZONE ${tz})::date = v.day AND COALESCE(le.payment_method, '') NOT IN ${NOT_DESK}), 0)::text AS collected
    FROM v ORDER BY v.day`);
  const total = empty();
  const byLocation = new Map<string, Tally>();
  const byWeek = new Map<string, Tally>();
  for (const r of rows) {
    const copayDue = Number(r.copay), priorDue = Number(r.prior), collected = Number(r.collected);
    const got = applyCollected(copayDue, priorDue, collected);
    for (const t of [total, get(byLocation, r.location!), get(byWeek, weekOf(r.day!))]) {
      t.visits++;
      t.copayDueCents += copayDue;
      t.copayCollectedCents += got.copay;
      t.priorDueCents += priorDue;
      t.priorCollectedCents += got.prior;
      t.collectedCents += collected;
    }
  }
  const { rows: staff } = await db.execute<Row>(sql`
    SELECT COALESCE(u.name, 'Online or automatic') AS name, count(*)::text AS n, sum(le.amount_cents)::text AS cents
    FROM ledger_entries le LEFT JOIN users u ON u.id = le.posted_by
    WHERE le.practice_id = ${practiceId} AND le.type = 'patient_payment' AND COALESCE(le.payment_method, '') NOT IN ${NOT_DESK}
      AND (le.posted_at AT TIME ZONE ${tz})::date BETWEEN ${from} AND ${to}
    GROUP BY 1 ORDER BY sum(le.amount_cents) DESC`);
  return {
    total,
    byLocation: [...byLocation].map(([location, t]) => ({ location, ...t })).sort((a, b) => b.visits - a.visits),
    byWeek: [...byWeek].map(([week, t]) => ({ week, ...t })).sort((a, b) => a.week.localeCompare(b.week)),
    byStaff: staff.map((s) => ({ name: s.name!, payments: Number(s.n), cents: Number(s.cents) })),
  };
}

function get<K>(m: Map<K, Tally>, k: K) {
  let t = m.get(k);
  if (!t) { t = empty(); m.set(k, t); }
  return t;
}

/** Collected over due, as a fraction; null when nothing was due. */
export const rate = (collected: number, due: number) => (due > 0 ? collected / due : null);
