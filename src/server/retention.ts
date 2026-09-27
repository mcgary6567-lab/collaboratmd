/**
 * Deletes operational records once they are past use, on a schedule, so logs
 * and notifications do not grow forever. Clinical and financial records
 * (patients, claims, the ledger, remittances, statements, documents) are never
 * touched here; they go only when a practice closes.
 *
 * HIPAA asks that its required documentation be kept six years; the audit log
 * and the record of messages sent to patients are kept seven, to leave margin.
 * Each period can be lengthened with RETENTION_<NAME>_DAYS; shortening one
 * below its minimum is refused.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

type Rule = { name: string; describe: string; days: number; minDays: number; where: (cutoff: string) => ReturnType<typeof sql>; table: string };

export const RULES: Rule[] = [
  { name: "NOTIFICATIONS", table: "notifications", describe: "Notifications that were read", days: 365, minDays: 30, where: (c) => sql`read_at IS NOT NULL AND created_at < ${c}::timestamptz` },
  { name: "UNREAD_NOTIFICATIONS", table: "notifications", describe: "Notifications never read", days: 730, minDays: 90, where: (c) => sql`read_at IS NULL AND created_at < ${c}::timestamptz` },
  { name: "RESOLVED_ERRORS", table: "error_events", describe: "Server errors marked resolved", days: 180, minDays: 30, where: (c) => sql`resolved_at IS NOT NULL AND last_seen < ${c}::timestamptz` },
  { name: "INTEGRATION_CHECKS", table: "integration_checks", describe: "Integration doctor results", days: 365, minDays: 30, where: (c) => sql`ran_at < ${c}::timestamptz` },
  { name: "WEBHOOK_DELIVERIES", table: "webhook_deliveries", describe: "Delivered webhook attempts", days: 365, minDays: 30, where: (c) => sql`delivered_at IS NOT NULL AND created_at < ${c}::timestamptz` },
  { name: "USAGE", table: "feature_usage", describe: "Daily usage counts", days: 730, minDays: 90, where: (c) => sql`day < ${c}::date` },
  { name: "FEEDBACK", table: "feedback", describe: "Resolved problem reports", days: 730, minDays: 90, where: (c) => sql`status = 'resolved' AND created_at < ${c}::timestamptz` },
  { name: "MESSAGES", table: "message_log", describe: "Record of texts and emails sent", days: 2555, minDays: 2190, where: (c) => sql`created_at < ${c}::timestamptz` },
  { name: "AUDIT_LOG", table: "audit_log", describe: "Audit log", days: 2555, minDays: 2190, where: (c) => sql`at < ${c}::timestamptz` },
];

export function retentionDays(rule: Rule, env: Record<string, string | undefined> = process.env) {
  const raw = env[`RETENTION_${rule.name}_DAYS`];
  const n = raw ? Number(raw) : rule.days;
  return Number.isFinite(n) && n >= rule.minDays ? Math.round(n) : rule.days;
}

/** Daily: deletes what each rule allows. Returns rows removed per rule. */
export async function applyRetention(db: Db, now = new Date(), env: Record<string, string | undefined> = process.env) {
  const out: Record<string, number> = {};
  for (const r of RULES) {
    const cutoff = new Date(now.getTime() - retentionDays(r, env) * 86_400_000).toISOString();
    const { rows } = await db.execute(sql`WITH d AS (DELETE FROM ${sql.raw(`"${r.table}"`)} WHERE ${r.where(cutoff)} RETURNING 1) SELECT count(*)::int AS n FROM d`);
    out[r.name] = Number((rows[0] as { n: number }).n);
  }
  return out;
}
