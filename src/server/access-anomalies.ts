/**
 * Unusual chart access, from the access log (server/access-log.ts): who opened
 * many more charts than they usually do, or charts of patients with no
 * current business with the practice. Snooping is usually found this way.
 *
 * These are starting points, not rules; a practice should adjust LIMITS to
 * what is normal for its staff. A flag is a prompt to look, not a finding.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { notify } from "./notifications";

export const LIMITS = {
  /** Different patients' charts one person opens in a day, above which it is always worth a look. */
  chartsPerDay: 40,
  /** Or this many times their usual daily count, when at least minForMultiple. */
  multiple: 3,
  minForMultiple: 15,
  /** Charts of patients with no appointment within 30 days either side, no claim or ledger activity in 180 days, and not new. */
  unrelatedPerDay: 10,
};

export type AccessDay = { userId: string; name: string; charts: number; usualPerDay: number; unrelated: number; flagged: boolean; why: string[] };

/** Each person's chart opening over the 24 hours before `now`, against their previous 30 days. */
export async function accessAnomalies(db: Db, practiceId: string, now = new Date()): Promise<AccessDay[]> {
  const dayStart = new Date(now.getTime() - 86_400_000).toISOString();
  const monthStart = new Date(now.getTime() - 31 * 86_400_000).toISOString();
  const nowIso = now.toISOString();
  const { rows } = await db.execute<{ user_id: string; name: string | null; charts: number; usual: number; unrelated: number }>(sql`
    WITH views AS (
      SELECT user_id, entity_id::uuid AS patient_id, at FROM audit_log
      WHERE practice_id = ${practiceId} AND action = 'patient_viewed' AND user_id IS NOT NULL AND at >= ${monthStart}::timestamptz AND at < ${nowIso}::timestamptz
    ),
    today AS (SELECT DISTINCT user_id, patient_id FROM views WHERE at >= ${dayStart}::timestamptz),
    earlier AS (
      SELECT user_id, count(DISTINCT (patient_id, date_trunc('day', at)))::float / 30 AS per_day
      FROM views WHERE at < ${dayStart}::timestamptz GROUP BY user_id
    )
    SELECT t.user_id, u.name, count(*)::int AS charts, coalesce(max(e.per_day), 0)::float AS usual,
      count(*) FILTER (WHERE
        NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = t.patient_id AND a.starts_at BETWEEN ${nowIso}::timestamptz - interval '30 days' AND ${nowIso}::timestamptz + interval '30 days')
        AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.patient_id = t.patient_id AND l.posted_at >= ${nowIso}::timestamptz - interval '180 days')
        AND NOT EXISTS (SELECT 1 FROM claims c WHERE c.patient_id = t.patient_id AND c.created_at >= ${nowIso}::timestamptz - interval '180 days')
        AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = t.patient_id AND p.created_at >= ${nowIso}::timestamptz - interval '30 days')
      )::int AS unrelated
    FROM today t
    LEFT JOIN earlier e ON e.user_id = t.user_id
    LEFT JOIN users u ON u.id = t.user_id
    GROUP BY t.user_id, u.name
    ORDER BY charts DESC`);
  return rows.map((r) => {
    const charts = Number(r.charts);
    const usual = Number(r.usual);
    const unrelated = Number(r.unrelated);
    const why: string[] = [];
    if (charts >= LIMITS.chartsPerDay) why.push(`${charts} charts in a day`);
    else if (charts >= LIMITS.minForMultiple && charts > LIMITS.multiple * usual) why.push(`${charts} charts, usually about ${Math.round(usual)} a day`);
    if (unrelated >= LIMITS.unrelatedPerDay) why.push(`${unrelated} patients with no appointment, claim or payment in months`);
    return { userId: r.user_id, name: r.name ?? "A former user", charts, usualPerDay: Math.round(usual * 10) / 10, unrelated, flagged: why.length > 0, why };
  });
}

/** Daily: tells the administrators about anyone flagged (naming the staff member, never a patient). */
export async function notifyAccessAnomalies(db: Db, practiceId: string, now = new Date()) {
  const flagged = (await accessAnomalies(db, practiceId, now)).filter((a) => a.flagged);
  const day = now.toISOString().slice(0, 10);
  for (const a of flagged) {
    await notify(db, practiceId, { kind: "access_anomaly", title: "Unusual chart access to review", body: `${a.name}: ${a.why.join("; ")}.`, href: "/settings/access-review", dedupeKey: `access-anomaly:${a.userId}:${day}` });
  }
  return flagged.length;
}

/** The patients one person opened in the 24 hours before `now`, for an administrator reviewing a flag. */
export async function chartsOpenedBy(db: Db, practiceId: string, userId: string, now = new Date()) {
  const { rows } = await db.execute<{ patient_id: string; first_name: string; last_name: string; mrn: string; last_at: string; times: number }>(sql`
    SELECT p.id AS patient_id, p.first_name, p.last_name, p.mrn, max(a.at)::text AS last_at, count(*)::int AS times
    FROM audit_log a JOIN patients p ON p.id = a.entity_id::uuid
    WHERE a.practice_id = ${practiceId} AND a.action = 'patient_viewed' AND a.user_id = ${userId}
      AND a.at >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz AND a.at < ${now.toISOString()}::timestamptz
    GROUP BY p.id, p.first_name, p.last_name, p.mrn ORDER BY max(a.at) DESC LIMIT 500`);
  return rows.map((r) => ({ patientId: r.patient_id, name: `${r.last_name}, ${r.first_name}`, mrn: r.mrn, lastAt: new Date(r.last_at), times: Number(r.times) }));
}
