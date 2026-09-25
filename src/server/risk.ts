/**
 * Denial risk for claims that have not gone out yet.
 *
 * Not a trained model: an explainable score built from this practice's own
 * last 12 months (how often this payer denied these procedure and diagnosis
 * codes) plus checks that commonly predict a denial (no recent eligibility
 * check, a likely duplicate, a filing deadline close or past, no auth number
 * where this payer has denied for authorization before). Every point comes
 * with the reason for it.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

export const PRE_SUBMIT = ["draft", "scrub_errors", "ready", "rejected"];
const ADJUDICATED = ["paid", "partially_paid", "denied", "billed_secondary", "closed"];

export type RiskLevel = "low" | "medium" | "high";
export type Risk = { score: number; level: RiskLevel; reasons: string[] };

export type HistoryStat = { kind: "cpt" | "dx"; code: string; n: number; denied: number; topCategory: string | null };
export type RiskInputs = {
  payerName: string;
  history: HistoryStat[];
  eligibilityVerified: boolean;
  duplicateOf: string | null;
  daysToFilingDeadline: number | null;
  hasAuthNumber: boolean;
  scrubWarnings: number;
};

const MIN_SAMPLE = 3;
/** Below this, a code's denials are ordinary background noise, not a reason. */
export const NOTABLE_RATE = 0.1;
/** Pulls small samples toward a 10% baseline so 1 denial in 1 claim is not "100%". */
export const smoothedRate = (denied: number, n: number) => (denied + 0.5) / (n + 5);

export function scoreRisk(i: RiskInputs): Risk {
  const reasons: string[] = [];
  let points = 0;

  const known = i.history.filter((h) => h.n >= MIN_SAMPLE && smoothedRate(h.denied, h.n) >= NOTABLE_RATE).sort((a, b) => smoothedRate(b.denied, b.n) - smoothedRate(a.denied, a.n));
  if (known.length) {
    const worst = known[0];
    points += Math.round(smoothedRate(worst.denied, worst.n) * 100);
    for (const h of known.slice(0, 3)) {
      reasons.push(`${i.payerName} denied ${h.denied} of ${h.n} claims with ${h.kind === "cpt" ? "procedure" : "diagnosis"} ${h.code} in the last 12 months${h.topCategory ? `, mostly for ${h.topCategory.replace(/_/g, " ")}` : ""}.`);
    }
    if (!i.hasAuthNumber && known.some((h) => h.topCategory === "authorization")) {
      points += 20;
      reasons.push("This payer has denied these codes for authorization, and the claim has no authorization number.");
    }
  }
  if (!i.eligibilityVerified) {
    points += 12;
    reasons.push("Coverage was not verified as active within 30 days of the visit.");
  }
  if (i.duplicateOf) {
    points += 30;
    reasons.push(`Claim ${i.duplicateOf} already bills the same patient, date and procedure; the payer may deny this one as a duplicate.`);
  }
  if (i.daysToFilingDeadline !== null) {
    if (i.daysToFilingDeadline < 0) {
      points += 45;
      reasons.push(`The timely filing deadline passed ${-i.daysToFilingDeadline} days ago.`);
    } else if (i.daysToFilingDeadline <= 14) {
      points += 15;
      reasons.push(`Only ${i.daysToFilingDeadline} days remain before the timely filing deadline.`);
    }
  }
  if (i.scrubWarnings > 0) {
    points += Math.min(15, i.scrubWarnings * 5);
    reasons.push(`${i.scrubWarnings} scrubber warning${i.scrubWarnings > 1 ? "s" : ""} not yet resolved.`);
  }
  const score = Math.min(99, points);
  return { score, level: score >= 45 ? "high" : score >= 20 ? "medium" : "low", reasons };
}

type Row = Record<string, string | null>;
const list = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);
const inList = (xs: string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);

/** Risk for several claims at once (a list page), in four queries whatever the count. */
export async function riskForClaims(db: Db, practiceId: string, claimIds: string[]): Promise<Map<string, Risk>> {
  const out = new Map<string, Risk>();
  if (!claimIds.length) return out;

  const { rows: claims } = await db.execute<Row>(sql`
    SELECT c.id, c.payer_id, p.name AS payer_name, c.patient_id, c.authorization_number, c.scrub_results::text AS scrub,
           c.timely_filing_deadline::text AS tfd, e.date_of_service::text AS dos, e.diagnoses::text AS dx,
           (SELECT string_agg(ch.cpt, ',') FROM charges ch WHERE ch.encounter_id = e.id) AS cpts,
           EXISTS (SELECT 1 FROM eligibility_checks ec WHERE ec.patient_insurance_id = c.patient_insurance_id AND ec.status = 'active'
                   AND ec.checked_at >= e.date_of_service - interval '30 days') AS elig,
           (SELECT o.control_number FROM claims o JOIN encounters oe ON oe.id = o.encounter_id
             WHERE o.practice_id = c.practice_id AND o.patient_id = c.patient_id AND o.id <> c.id
               AND oe.date_of_service = e.date_of_service AND o.payer_sequence = 'P' AND c.payer_sequence = 'P'
               AND o.status NOT IN ('voided') AND o.frequency_code = '1'
               AND o.id IS DISTINCT FROM c.original_claim_id AND o.original_claim_id IS DISTINCT FROM c.id
               AND EXISTS (SELECT 1 FROM charges a JOIN charges b ON a.cpt = b.cpt WHERE a.encounter_id = oe.id AND b.encounter_id = e.id)
             ORDER BY o.created_at LIMIT 1) AS dup
    FROM claims c JOIN encounters e ON e.id = c.encounter_id JOIN payers p ON p.id = c.payer_id
    WHERE c.practice_id = ${practiceId} AND c.id IN (${list(claimIds)})`);
  if (!claims.length) return out;

  const payerIds = [...new Set(claims.map((c) => c.payer_id as string))];
  const hist = sql`
    WITH adj AS (
      SELECT c.id, c.payer_id, c.encounter_id,
             (SELECT d.category FROM denials d WHERE d.claim_id = c.id ORDER BY d.created_at LIMIT 1) AS category
      FROM claims c
      WHERE c.practice_id = ${practiceId} AND c.payer_sequence = 'P' AND c.payer_id IN (${inList(payerIds)})
        AND c.created_at > now() - interval '12 months' AND c.id NOT IN (${list(claimIds)})
        AND (c.status IN (${inList(ADJUDICATED)}) OR EXISTS (SELECT 1 FROM denials d WHERE d.claim_id = c.id))
    )`;
  const [{ rows: byCpt }, { rows: byDx }] = await Promise.all([
    db.execute<Row>(sql`${hist}
      SELECT a.payer_id, ch.cpt AS code, count(DISTINCT a.id)::text AS n, count(DISTINCT a.id) FILTER (WHERE a.category IS NOT NULL)::text AS denied,
             mode() WITHIN GROUP (ORDER BY a.category) FILTER (WHERE a.category IS NOT NULL) AS top
      FROM adj a JOIN charges ch ON ch.encounter_id = a.encounter_id GROUP BY 1, 2`),
    db.execute<Row>(sql`${hist}
      SELECT a.payer_id, dx.code, count(DISTINCT a.id)::text AS n, count(DISTINCT a.id) FILTER (WHERE a.category IS NOT NULL)::text AS denied,
             mode() WITHIN GROUP (ORDER BY a.category) FILTER (WHERE a.category IS NOT NULL) AS top
      FROM adj a JOIN encounters e ON e.id = a.encounter_id CROSS JOIN LATERAL jsonb_array_elements_text(e.diagnoses) AS dx(code) GROUP BY 1, 2`),
  ]);
  const index = new Map<string, HistoryStat>();
  for (const r of byCpt) index.set(`${r.payer_id}|cpt|${r.code}`, { kind: "cpt", code: r.code!, n: Number(r.n), denied: Number(r.denied), topCategory: r.top });
  for (const r of byDx) index.set(`${r.payer_id}|dx|${r.code}`, { kind: "dx", code: r.code!, n: Number(r.n), denied: Number(r.denied), topCategory: r.top });

  const today = Date.parse(new Date().toISOString().slice(0, 10));
  for (const c of claims) {
    const cpts = [...new Set((c.cpts ?? "").split(",").filter(Boolean))];
    const dxs: string[] = JSON.parse(c.dx ?? "[]");
    const history = [
      ...cpts.map((code) => index.get(`${c.payer_id}|cpt|${code}`)),
      ...dxs.map((code) => index.get(`${c.payer_id}|dx|${code}`)),
    ].filter((h): h is HistoryStat => !!h);
    const scrub: { severity: string }[] = JSON.parse(c.scrub ?? "[]");
    out.set(c.id!, scoreRisk({
      payerName: c.payer_name!,
      history,
      eligibilityVerified: String(c.elig) === "true",
      duplicateOf: c.dup,
      daysToFilingDeadline: c.tfd ? Math.round((Date.parse(c.tfd) - today) / 86_400_000) : null,
      hasAuthNumber: !!c.authorization_number,
      scrubWarnings: scrub.filter((f) => f.severity === "warning").length,
    }));
  }
  return out;
}

export async function claimRisk(db: Db, practiceId: string, claimId: string) {
  return (await riskForClaims(db, practiceId, [claimId])).get(claimId) ?? null;
}
