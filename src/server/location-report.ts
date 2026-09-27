/**
 * Each location side by side for a period of visits: volume, what was billed
 * and collected, what is still open, and how often claims were denied. Visits
 * with no location count under the main office (the billing address).
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

export type LocationRow = {
  locationId: string | null; name: string; visits: number; claims: number;
  chargesCents: number; insurancePaidCents: number; patientPaidCents: number; adjustmentsCents: number; openCents: number;
  deniedClaims: number; denialRate: number | null; collectedPerVisitCents: number | null;
};

export async function locationSummary(db: Db, practiceId: string, from: string, to: string): Promise<LocationRow[]> {
  const { rows } = await db.execute(sql`
    WITH c AS (
      SELECT e.location_id, c.id, c.total_cents
      FROM claims c JOIN encounters e ON e.id = c.encounter_id
      WHERE c.practice_id = ${practiceId} AND c.frequency_code = '1' AND c.payer_sequence = 'P'
        AND e.date_of_service >= ${from}::date AND e.date_of_service <= ${to}::date
    ),
    l AS (
      SELECT l.claim_id,
        COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'charge'), 0) AS charged,
        COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'insurance_payment'), 0) AS ins,
        COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'patient_payment'), 0) AS pat,
        COALESCE(sum(l.amount_cents) FILTER (WHERE l.type IN ('adjustment', 'write_off', 'discount', 'bad_debt')), 0) AS adj,
        COALESCE(sum(l.amount_cents) FILTER (WHERE l.type = 'reversal'), 0) AS rev
      FROM ledger_entries l WHERE l.practice_id = ${practiceId} AND l.claim_id IN (SELECT id FROM c)
      GROUP BY l.claim_id
    ),
    d AS (SELECT DISTINCT claim_id FROM denials WHERE practice_id = ${practiceId} AND claim_id IN (SELECT id FROM c)),
    v AS (
      SELECT e.location_id, count(*)::int AS visits FROM encounters e
      WHERE e.practice_id = ${practiceId} AND e.date_of_service >= ${from}::date AND e.date_of_service <= ${to}::date GROUP BY 1
    )
    SELECT c.location_id, COALESCE(loc.name, 'Main office') AS name, COALESCE(max(v.visits), 0)::int AS visits, count(c.id)::int AS claims,
      COALESCE(sum(l.charged), 0)::bigint AS charges, COALESCE(sum(l.ins), 0)::bigint AS ins, COALESCE(sum(l.pat), 0)::bigint AS pat, COALESCE(sum(l.adj), 0)::bigint AS adj,
      COALESCE(sum(GREATEST(l.charged - l.ins - l.pat - l.adj + l.rev, 0)), 0)::bigint AS open,
      count(d.claim_id)::int AS denied
    FROM c LEFT JOIN l ON l.claim_id = c.id LEFT JOIN d ON d.claim_id = c.id
    LEFT JOIN locations loc ON loc.id = c.location_id
    LEFT JOIN v ON v.location_id IS NOT DISTINCT FROM c.location_id
    GROUP BY c.location_id, loc.name
    ORDER BY charges DESC`);
  return (rows as Record<string, unknown>[]).map((r) => {
    const n = (k: string) => Number(r[k] ?? 0);
    const visits = n("visits");
    return {
      locationId: (r.location_id as string) ?? null, name: String(r.name), visits, claims: n("claims"),
      chargesCents: n("charges"), insurancePaidCents: n("ins"), patientPaidCents: n("pat"), adjustmentsCents: n("adj"), openCents: n("open"),
      deniedClaims: n("denied"), denialRate: n("claims") ? n("denied") / n("claims") : null,
      collectedPerVisitCents: visits ? Math.round((n("ins") + n("pat")) / visits) : null,
    };
  });
}
