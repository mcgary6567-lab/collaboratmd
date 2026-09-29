/**
 * Which scrub warnings turned into denials. A warning lets a claim go out; if
 * claims sent with a given warning are denied far more often than claims in
 * general, the warning is worth treating as an error for that payer (a payer
 * edit that blocks) or across the board (strict scrubbing).
 *
 * Uses the findings saved on each claim when it was last scrubbed, for claims
 * submitted in the period, against the denials recorded for them.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

type Row = Record<string, string | null>;

export type WarningOutcome = { rule: string; payerId: string; payerName: string; sent: number; denied: number; rate: number; topCarc: string | null; suggest: boolean };

/** Pure: whether a warning's denial rate is high enough, on enough claims, to suggest blocking it. */
export function shouldBlock(sent: number, denied: number, baselineRate: number) {
  if (sent < 10) return false;
  const rate = denied / sent;
  return rate >= 0.3 && rate >= baselineRate * 2;
}

export async function warningOutcomes(db: Db, practiceId: string, from: string, to: string) {
  const [{ rows: base }, { rows }] = await Promise.all([
    db.execute<Row>(sql`
      SELECT count(*)::text AS sent, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM denials d WHERE d.claim_id = c.id))::text AS denied
      FROM claims c WHERE c.practice_id = ${practiceId} AND c.submitted_at::date BETWEEN ${from} AND ${to}`),
    db.execute<Row>(sql`
      WITH warned AS (
        SELECT DISTINCT c.id, c.payer_id, f->>'rule' AS rule
        FROM claims c, jsonb_array_elements(c.scrub_results) f
        WHERE c.practice_id = ${practiceId} AND c.submitted_at::date BETWEEN ${from} AND ${to} AND f->>'severity' = 'warning'
      ),
      -- Each claim's denials once, rather than once per rule and payer.
      claim_denials AS (
        SELECT d.claim_id, d.carc FROM denials d WHERE d.practice_id = ${practiceId} AND d.claim_id IN (SELECT id FROM warned)
      ),
      totals AS (
        SELECT w.rule, w.payer_id, count(*) AS sent, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM claim_denials cd WHERE cd.claim_id = w.id)) AS denied
        FROM warned w GROUP BY w.rule, w.payer_id
      ),
      carcs AS (
        SELECT w.rule, w.payer_id, cd.carc, row_number() OVER (PARTITION BY w.rule, w.payer_id ORDER BY count(*) DESC, cd.carc) AS n
        FROM warned w JOIN claim_denials cd ON cd.claim_id = w.id GROUP BY w.rule, w.payer_id, cd.carc
      )
      SELECT t.rule, t.payer_id, py.name AS payer, t.sent::text AS sent, t.denied::text AS denied, cr.carc AS top_carc
      FROM totals t JOIN payers py ON py.id = t.payer_id
      LEFT JOIN carcs cr ON cr.rule = t.rule AND cr.payer_id = t.payer_id AND cr.n = 1
      ORDER BY t.denied DESC, t.sent DESC
      LIMIT 200`),
  ]);
  const baseline = Number(base[0]?.sent) ? Number(base[0].denied) / Number(base[0].sent) : 0;
  const outcomes: WarningOutcome[] = rows.map((r) => {
    const sent = Number(r.sent);
    const denied = Number(r.denied);
    return { rule: r.rule!, payerId: r.payer_id!, payerName: r.payer!, sent, denied, rate: sent ? denied / sent : 0, topCarc: r.top_carc, suggest: shouldBlock(sent, denied, baseline) };
  });
  return { baseline, claims: Number(base[0]?.sent ?? 0), outcomes };
}
