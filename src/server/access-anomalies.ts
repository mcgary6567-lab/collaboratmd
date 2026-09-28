/**
 * Unusual chart access, from the access log (server/access-log.ts): who opened
 * many more charts than they usually do, or charts of patients with no
 * current business with the practice. Snooping is usually found this way.
 *
 * These are starting points, not rules: an administrator sets the limits to
 * what is normal for the practice's staff (Settings > Chart access review),
 * and records what they found for each flag. A flag is a prompt to look, not
 * a finding.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notify } from "./notifications";

const { practices, auditLog, users } = schema;

/** The defaults, until a practice sets its own. */
export const LIMITS = {
  /** Different patients' charts one person opens in a day, above which it is always worth a look. */
  chartsPerDay: 40,
  /** Or this many times their usual daily count, when at least minForMultiple. */
  multiple: 3,
  minForMultiple: 15,
  /** Charts of patients with no appointment within 30 days either side, no claim or ledger activity in 180 days, and not new. */
  unrelatedPerDay: 10,
};
export type AccessLimits = typeof LIMITS;

/** What each limit may be set to: low enough to be useful, high enough not to flag every morning. */
export const LIMIT_RANGES: Record<keyof AccessLimits, { min: number; max: number; label: string }> = {
  chartsPerDay: { min: 5, max: 2000, label: "Charts in a day" },
  multiple: { min: 1.5, max: 50, label: "Times their usual" },
  minForMultiple: { min: 1, max: 2000, label: "Only when at least" },
  unrelatedPerDay: { min: 1, max: 2000, label: "Charts with no current business" },
};

/** The practice's limits: its own where set, the defaults otherwise. */
export async function accessLimits(db: Db, practiceId: string): Promise<AccessLimits> {
  const [p] = await db.select({ policies: practices.policies }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  return { ...LIMITS, ...(p?.policies?.accessReview ?? {}) };
}

/** Saves the practice's limits (each within LIMIT_RANGES), recording the change in the audit log. */
export async function saveAccessLimits(db: Db, practiceId: string, input: Partial<Record<keyof AccessLimits, number>>, userId: string) {
  const next = {} as AccessLimits;
  for (const k of Object.keys(LIMITS) as (keyof AccessLimits)[]) {
    const v = input[k];
    const r = LIMIT_RANGES[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < r.min || v > r.max) throw new Error(`${r.label} must be between ${r.min} and ${r.max}`);
    next[k] = k === "multiple" ? Math.round(v * 10) / 10 : Math.round(v);
  }
  const before = await accessLimits(db, practiceId);
  await db.update(practices).set({ policies: sql`${practices.policies} || ${JSON.stringify({ accessReview: next })}::jsonb` }).where(eq(practices.id, practiceId));
  await db.insert(auditLog).values({ practiceId, userId, action: "access_review_limits_changed", entity: "practice", entityId: practiceId, details: { before, after: next } });
  return next;
}

export type AccessDay = { userId: string; name: string; charts: number; usualPerDay: number; unrelated: number; flagged: boolean; why: string[] };

/** Each person's chart opening over the 24 hours before `now`, against their previous 30 days. */
export async function accessAnomalies(db: Db, practiceId: string, now = new Date(), limits?: AccessLimits): Promise<AccessDay[]> {
  const L = limits ?? (await accessLimits(db, practiceId));
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
    if (charts >= L.chartsPerDay) why.push(`${charts} charts in a day`);
    else if (charts >= L.minForMultiple && charts > L.multiple * usual) why.push(`${charts} charts, usually about ${Math.round(usual)} a day`);
    if (unrelated >= L.unrelatedPerDay) why.push(`${unrelated} patients with no appointment, claim or payment in months`);
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

/**
 * An administrator's note on a flag: what they asked and found ("Covering the
 * front desk during the audit"). It goes in the audit log, so the review
 * itself leaves a record. One note per person per day; a later one adds to it.
 */
export async function reviewFlag(db: Db, practiceId: string, reviewer: string, flag: { userId: string; day: string; why: string[] }, note: string) {
  const text = note.trim().replace(/\s+/g, " ").slice(0, 1000);
  if (text.length < 5) throw new Error("Write what you found, in a few words");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(flag.day)) throw new Error("Unknown day");
  const [person] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, flag.userId), eq(users.practiceId, practiceId))).limit(1);
  if (!person) throw new Error("That person is not in this practice");
  await db.insert(auditLog).values({ practiceId, userId: reviewer, action: "access_flag_reviewed", entity: "user", entityId: flag.userId, details: { day: flag.day, why: flag.why, note: text } });
}

export type FlagReview = { at: Date; reviewer: string; userId: string; person: string; day: string; note: string; why: string[] };

/** Reviews recorded in the last `days` days, newest first. */
export async function flagReviews(db: Db, practiceId: string, days = 90, now = new Date()): Promise<FlagReview[]> {
  const rows = await db
    .select({ log: auditLog, name: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.practiceId, practiceId), eq(auditLog.action, "access_flag_reviewed"), gte(auditLog.at, new Date(now.getTime() - days * 86_400_000))))
    .orderBy(desc(auditLog.at))
    .limit(200);
  const ids = [...new Set(rows.map((r) => r.log.entityId).filter((x): x is string => !!x))];
  const people = new Map(ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
  return rows.map(({ log, name }) => {
    const d = (log.details ?? {}) as { day?: string; note?: string; why?: string[] };
    return { at: log.at, reviewer: name ?? "A former user", userId: log.entityId ?? "", person: people.get(log.entityId ?? "") ?? "A former user", day: d.day ?? "", note: d.note ?? "", why: d.why ?? [] };
  });
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
