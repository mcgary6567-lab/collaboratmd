/**
 * Payer behavior alerts: a payer that starts denying more, paying slower,
 * paying less, or citing a new denial reason usually changed a policy or a
 * system. Catching it in weeks instead of at quarter end saves the claims in
 * between.
 *
 * Each payer's last 30 days are compared with its own previous 90. An alert
 * needs both a meaningful change and enough claims that it is not noise.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

type Row = Record<string, string | null>;
const DAY = 86_400_000;
export const RECENT_DAYS = 30;
export const BASELINE_DAYS = 90;
/** Claims a payer must have adjudicated in the recent window before any rate is compared. */
export const MIN_CLAIMS = 20;

export type PayerAlert = {
  payerId: string;
  payerName: string;
  kind: "denial_rate" | "slower" | "paying_less" | "new_reason";
  title: string;
  detail: string;
  recent: number;
  baseline: number;
  severity: "high" | "medium";
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function payerAlerts(db: Db, practiceId: string, now = new Date()): Promise<PayerAlert[]> {
  const recentStart = new Date(now.getTime() - RECENT_DAYS * DAY);
  const baseStart = new Date(recentStart.getTime() - BASELINE_DAYS * DAY);
  const window = (col: string) => sql.raw(`CASE WHEN ${col} >= '${recentStart.toISOString()}' THEN 'recent' ELSE 'base' END`);

  const [{ rows: outcome }, { rows: carcs }] = await Promise.all([
    // One row per payer and window: claims first adjudicated there (first payment or denial), how many were denied, pay lag and paid-to-billed.
    db.execute<Row>(sql`
      WITH pay AS (
        SELECT claim_id, min(posted_at) AS paid_at, sum(amount_cents) AS paid
        FROM ledger_entries WHERE practice_id = ${practiceId} AND type = 'insurance_payment' GROUP BY 1
      ), den AS (
        SELECT claim_id, min(created_at) AS denied_at FROM denials WHERE practice_id = ${practiceId} GROUP BY 1
      ), first_event AS (
        SELECT c.id, c.payer_id, c.total_cents, c.submitted_at, pay.paid_at, COALESCE(pay.paid, 0) AS paid, den.denied_at
        FROM claims c LEFT JOIN pay ON pay.claim_id = c.id LEFT JOIN den ON den.claim_id = c.id
        WHERE c.practice_id = ${practiceId} AND c.frequency_code = '1' AND c.submitted_at >= ${new Date(baseStart.getTime() - 120 * DAY)}
          AND (pay.claim_id IS NOT NULL OR den.claim_id IS NOT NULL)
      ), decided AS (
        SELECT *, LEAST(COALESCE(paid_at, denied_at), COALESCE(denied_at, paid_at)) AS decided_at FROM first_event
      )
      SELECT payer_id, ${window("decided_at")} AS win,
        count(*)::text AS n,
        count(*) FILTER (WHERE denied_at IS NOT NULL AND (paid_at IS NULL OR denied_at <= paid_at))::text AS denied,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(0, paid_at::date - submitted_at::date)) FILTER (WHERE paid_at IS NOT NULL AND submitted_at IS NOT NULL)::text AS lag,
        COALESCE(sum(paid) FILTER (WHERE paid > 0), 0)::text AS paid,
        COALESCE(sum(total_cents) FILTER (WHERE paid > 0), 0)::text AS billed
      FROM decided
      WHERE decided_at >= ${baseStart} AND decided_at < ${now}
      GROUP BY 1, 2`),
    db.execute<Row>(sql`
      SELECT c.payer_id, d.carc, ${window("d.created_at")} AS win, count(*)::text AS n
      FROM denials d JOIN claims c ON c.id = d.claim_id
      WHERE d.practice_id = ${practiceId} AND d.created_at >= ${baseStart} AND d.created_at < ${now} AND d.carc IS NOT NULL
      GROUP BY 1, 2, 3`),
  ]);
  const { rows: names } = await db.execute<Row>(sql`SELECT id, name FROM payers WHERE practice_id = ${practiceId}`);
  const name = new Map(names.map((p) => [p.id!, p.name!]));

  type Stats = { n: number; denied: number; lag: number | null; paid: number; billed: number };
  const stats = new Map<string, { recent?: Stats; base?: Stats }>();
  for (const r of outcome) {
    const s = stats.get(r.payer_id!) ?? {};
    s[r.win as "recent" | "base"] = { n: Number(r.n), denied: Number(r.denied), lag: r.lag === null ? null : Number(r.lag), paid: Number(r.paid), billed: Number(r.billed) };
    stats.set(r.payer_id!, s);
  }

  const alerts: PayerAlert[] = [];
  for (const [payerId, { recent, base }] of stats) {
    if (!recent || !base || recent.n < MIN_CLAIMS || base.n < MIN_CLAIMS) continue;
    const payerName = name.get(payerId) ?? "Unknown payer";
    const dr = recent.denied / recent.n, db0 = base.denied / base.n;
    if (dr - db0 >= 0.05 && dr >= db0 * 1.3) {
      alerts.push({ payerId, payerName, kind: "denial_rate", title: "Denying more claims", detail: `${pct(dr)} of claims denied in the last ${RECENT_DAYS} days, up from ${pct(db0)} over the ${BASELINE_DAYS} days before (${recent.denied} of ${recent.n}).`, recent: dr, baseline: db0, severity: dr - db0 >= 0.1 ? "high" : "medium" });
    }
    if (recent.lag !== null && base.lag !== null && recent.lag - base.lag >= 5 && recent.lag >= base.lag * 1.25) {
      alerts.push({ payerId, payerName, kind: "slower", title: "Paying slower", detail: `Median ${Math.round(recent.lag)} days from submission to payment, up from ${Math.round(base.lag)}.`, recent: recent.lag, baseline: base.lag, severity: recent.lag - base.lag >= 10 ? "high" : "medium" });
    }
    if (recent.billed && base.billed) {
      const pr = recent.paid / recent.billed, pb = base.paid / base.billed;
      if (pb - pr >= 0.05 && pr <= pb * 0.93) {
        alerts.push({ payerId, payerName, kind: "paying_less", title: "Paying less per claim", detail: `Paid ${pct(pr)} of billed charges on paid claims, down from ${pct(pb)}. Check for a fee schedule change or new bundling; the underpayment scan compares against your contract.`, recent: pr, baseline: pb, severity: pb - pr >= 0.1 ? "high" : "medium" });
      }
    }
  }

  // A denial reason that is suddenly frequent: at least 5 in the window and 3x its earlier monthly rate.
  const reasons = new Map<string, { recent: number; base: number }>();
  for (const r of carcs) {
    const k = `${r.payer_id}|${r.carc}`;
    const v = reasons.get(k) ?? { recent: 0, base: 0 };
    v[r.win as "recent" | "base"] += Number(r.n);
    reasons.set(k, v);
  }
  for (const [k, v] of reasons) {
    const perMonth = (v.base * RECENT_DAYS) / BASELINE_DAYS;
    if (v.recent >= 5 && v.recent >= 3 * (perMonth + 1)) {
      const [payerId, carc] = k.split("|");
      alerts.push({ payerId, payerName: name.get(payerId) ?? "Unknown payer", kind: "new_reason", title: `Denial reason ${carc} spiking`, detail: `${v.recent} denials citing CARC ${carc} in the last ${RECENT_DAYS} days, against about ${perMonth.toFixed(1)} a month before.`, recent: v.recent, baseline: perMonth, severity: v.recent >= 10 ? "high" : "medium" });
    }
  }
  return alerts.sort((a, b) => (a.severity === b.severity ? a.payerName.localeCompare(b.payerName) : a.severity === "high" ? -1 : 1));
}
