import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/db";

/**
 * Attempt budgets per caller address. Each account also locks itself after repeated
 * wrong passwords (server/mfa.ts); these limits slow one address guessing across many
 * accounts or many emails, which the per-account lockout cannot see.
 */
export const LIMITS = {
  login: { max: 30, windowSec: 15 * 60 },
  reset: { max: 5, windowSec: 60 * 60 },
  portal: { max: 20, windowSec: 15 * 60 },
  signup: { max: 5, windowSec: 60 * 60 },
  booking: { max: 10, windowSec: 60 * 60 },
} as const;
export type ThrottleKind = keyof typeof LIMITS;

/** The address is stored only as a hash, so the table is not a log of who visited. */
export function throttleKey(kind: ThrottleKind, ip: string | null): string {
  return `${kind}:${createHash("sha256").update(ip ?? "unknown").digest("hex").slice(0, 32)}`;
}

/** Counts one attempt and says whether it is within the budget, in one statement so parallel requests cannot race past it. */
export async function hit(db: Db, kind: ThrottleKind, ip: string | null, now = new Date()): Promise<{ ok: boolean; retryAfterSec: number }> {
  const { max, windowSec } = LIMITS[kind];
  const key = throttleKey(kind, ip);
  const since = new Date(now.getTime() - windowSec * 1000);
  const { rows } = await db.execute(sql`
    INSERT INTO auth_throttle (key, window_start, count) VALUES (${key}, ${now.toISOString()}::timestamptz, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN auth_throttle.window_start <= ${since.toISOString()}::timestamptz THEN 1 ELSE auth_throttle.count + 1 END,
      window_start = CASE WHEN auth_throttle.window_start <= ${since.toISOString()}::timestamptz THEN ${now.toISOString()}::timestamptz ELSE auth_throttle.window_start END
    RETURNING count, window_start`);
  const row = rows[0] as { count: number | string; window_start: string | Date };
  const count = Number(row.count);
  const resetAt = new Date(row.window_start).getTime() + windowSec * 1000;
  return { ok: count <= max, retryAfterSec: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)) };
}

/** Old windows are useless once they end; the daily jobs clear them. */
export async function pruneThrottle(db: Db, now = new Date()): Promise<number> {
  const longest = Math.max(...Object.values(LIMITS).map((l) => l.windowSec));
  const { rows } = await db.execute(sql`DELETE FROM auth_throttle WHERE window_start < ${new Date(now.getTime() - longest * 1000).toISOString()}::timestamptz RETURNING key`);
  return rows.length;
}

export function waitMessage(retryAfterSec: number): string {
  const min = Math.ceil(retryAfterSec / 60);
  return `Too many attempts from this network. Try again in ${min} minute${min === 1 ? "" : "s"}.`;
}
