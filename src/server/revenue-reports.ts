/**
 * Two management reports.
 *
 * Contract comparison: what each payer actually allowed over a period (paid
 * plus the patient's share), against what Medicare's fee schedule would have
 * allowed for the same claims in the practice's locality, and what a proposed
 * percent of Medicare would have brought in. Claims count only when every line
 * has a Medicare rate; the multiple-procedure reduction is not applied, so
 * surgical claims read slightly high on the Medicare side.
 *
 * Lag: days from visit to charge entry, and from charge entry to submission,
 * by provider. Lag is the earliest sign of cash coming in late.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { FACILITY_POS, practiceLocality } from "./mpfs";

type Row = Record<string, string | null>;

export async function contractComparison(db: Db, practiceId: string, from: string, to: string) {
  const loc = await practiceLocality(db, practiceId);
  if (!loc) return { ready: false as const, reason: "Choose the practice's Medicare locality on the practice profile first." };
  const facility = [...FACILITY_POS];
  const { rows } = await db.execute<Row>(sql`
    WITH lines AS (
      SELECT cl.id AS claim_id, ch.units,
        (SELECT round(((r.work_rvu * g.work_gpci + (CASE WHEN e.place_of_service IN (${sql.join(facility.map((p) => sql`${p}`), sql`, `)}) THEN r.pe_facility ELSE r.pe_non_facility END) * g.pe_gpci + r.mp_rvu * g.mp_gpci) * y.conversion_factor) * 100)
           FROM mpfs_years y
           JOIN mpfs_localities g ON g.year = y.year AND g.carrier = ${loc.carrier} AND g.locality = ${loc.locality}
           JOIN mpfs_rvus r ON r.year = y.year AND r.code = ch.cpt AND r.modifier = ''
           WHERE y.year = (SELECT max(y2.year) FROM mpfs_years y2 WHERE y2.year <= extract(year FROM e.date_of_service))) AS rate
      FROM claims cl JOIN encounters e ON e.id = cl.encounter_id JOIN charges ch ON ch.encounter_id = e.id
      JOIN payers py ON py.id = cl.payer_id
      WHERE cl.practice_id = ${practiceId} AND py.type NOT IN ('medicare', 'self_pay') AND cl.payer_sequence = 'P'
        AND cl.status IN ('paid', 'partially_paid') AND e.date_of_service BETWEEN ${from} AND ${to}
    ),
    priced AS (
      SELECT claim_id, sum(units * rate)::bigint AS medicare FROM lines GROUP BY claim_id HAVING bool_and(rate IS NOT NULL AND rate > 0)
    ),
    allowed AS (
      SELECT claim_id,
        (COALESCE(sum(amount_cents) FILTER (WHERE type = 'insurance_payment'), 0) - COALESCE(sum(amount_cents) FILTER (WHERE type = 'reversal'), 0)
          + COALESCE(sum(amount_cents) FILTER (WHERE type = 'transfer_to_patient'), 0))::bigint AS allowed
      FROM ledger_entries WHERE practice_id = ${practiceId} AND claim_id IN (SELECT claim_id FROM priced) GROUP BY claim_id
    )
    SELECT py.id, py.name, py.type, count(*)::text AS claims, sum(a.allowed)::text AS allowed, sum(p.medicare)::text AS medicare
    FROM priced p JOIN allowed a ON a.claim_id = p.claim_id JOIN claims cl ON cl.id = p.claim_id JOIN payers py ON py.id = cl.payer_id
    GROUP BY py.id, py.name, py.type ORDER BY sum(a.allowed) DESC`);
  return {
    ready: true as const,
    payers: rows.map((r) => {
      const allowed = Number(r.allowed);
      const medicare = Number(r.medicare);
      return { payerId: r.id!, name: r.name!, type: r.type!, claims: Number(r.claims), allowedCents: allowed, medicareCents: medicare, percentOfMedicare: medicare ? Math.round((allowed / medicare) * 1000) / 10 : null };
    }),
  };
}

/** Pure: what a payer would have allowed at a percent of Medicare, and the difference from what it did. */
export function whatIf(p: { allowedCents: number; medicareCents: number }, percent: number) {
  const projected = Math.round((p.medicareCents * percent) / 100);
  return { projectedCents: projected, differenceCents: projected - p.allowedCents };
}

export async function lagReport(db: Db, practiceId: string, from: string, to: string) {
  // A charge was entered no later than its claim was created or sent (imported history can carry a later
  // encounter timestamp), and never before the visit.
  const { rows } = await db.execute<Row>(sql`
    WITH v AS (
      SELECT e.provider_id, e.date_of_service, cl.submitted_at::date AS submitted, cl.status,
        LEAST(e.created_at, COALESCE(cl.created_at, e.created_at), COALESCE(cl.submitted_at, e.created_at))::date AS entered
      FROM encounters e
      LEFT JOIN LATERAL (SELECT c.created_at, c.submitted_at, c.status FROM claims c WHERE c.encounter_id = e.id AND c.payer_sequence = 'P' ORDER BY c.created_at LIMIT 1) cl ON true
      WHERE e.practice_id = ${practiceId} AND e.date_of_service BETWEEN ${from} AND ${to}
    ),
    lag AS (
      SELECT provider_id, status, submitted, GREATEST(entered - date_of_service, 0) AS charge_days, GREATEST(submitted - GREATEST(entered, date_of_service), 0) AS submit_days FROM v
    )
    SELECT pr.id, pr.first_name, pr.last_name, pr.credential, count(*)::text AS visits,
      round(avg(charge_days), 1)::text AS charge_avg,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY charge_days)::text AS charge_median,
      count(*) FILTER (WHERE charge_days > 7)::text AS charge_late,
      round(avg(submit_days) FILTER (WHERE submitted IS NOT NULL), 1)::text AS submit_avg,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY submit_days) FILTER (WHERE submitted IS NOT NULL)::text AS submit_median,
      count(*) FILTER (WHERE submitted IS NULL AND status IN ('draft', 'scrub_errors', 'ready'))::text AS unsent
    FROM lag JOIN providers pr ON pr.id = lag.provider_id
    GROUP BY pr.id, pr.first_name, pr.last_name, pr.credential
    ORDER BY avg(charge_days) DESC NULLS LAST`);
  const num = (v: string | null) => (v === null ? null : Number(v));
  return rows.map((r) => ({
    providerId: r.id!, name: `${r.first_name} ${r.last_name}${r.credential ? `, ${r.credential}` : ""}`, visits: Number(r.visits),
    chargeAvg: num(r.charge_avg), chargeMedian: num(r.charge_median), chargeLate: Number(r.charge_late),
    submitAvg: num(r.submit_avg), submitMedian: num(r.submit_median), unsent: Number(r.unsent),
  }));
}
