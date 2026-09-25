/**
 * Server error monitoring without a third-party service: Next.js reports
 * every server error to instrumentation.ts, which records it here, grouped
 * by where it happened and what it said.
 *
 * Errors can carry patient information (a database error quoting a value, a
 * search term in a URL), so nothing is stored raw: the query string is
 * dropped, emails, long numbers, dates and quoted values are masked, and no
 * request headers are kept.
 */
import crypto from "node:crypto";
import { desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { errorEvents } = schema;

export function redact(text: string) {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[id]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, "[date]")
    .replace(/\(([^()]*)\)=\(([^()]*)\)/g, "($1)=([value])") // Postgres "Key (email)=(x) already exists"
    .replace(/"[^"]{1,200}"|'[^']{1,200}'/g, '"[value]"')
    .replace(/\b[A-Z]{0,4}\d{5,}\b/g, "[number]")
    .slice(0, 500);
}

export type ErrorReport = { message: string; digest?: string; path: string; method: string; routePath?: string; routeType?: string };

export async function recordError(db: Db, r: ErrorReport, now = new Date()) {
  const message = redact(r.message.split("\n")[0] || "Unknown error");
  const path = r.path.split("?")[0].replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id").slice(0, 200);
  const fingerprint = crypto.createHash("sha1").update(`${r.routePath ?? path}|${message.replace(/\[\w+\]/g, "")}`).digest("hex");
  await db.insert(errorEvents).values({ fingerprint, message, digest: r.digest ?? null, routePath: r.routePath ?? null, routeType: r.routeType ?? null, method: r.method, path, lastSeen: now, firstSeen: now })
    .onConflictDoUpdate({ target: errorEvents.fingerprint, set: { count: sql`${errorEvents.count} + 1`, lastSeen: now, digest: r.digest ?? null, resolvedAt: null } });
  return fingerprint;
}

export async function listErrors(db: Db, includeResolved = false) {
  return db.select().from(errorEvents).where(includeResolved ? undefined : isNull(errorEvents.resolvedAt)).orderBy(desc(errorEvents.lastSeen)).limit(200);
}

export async function resolveError(db: Db, fingerprint: string) {
  await db.update(errorEvents).set({ resolvedAt: new Date() }).where(eq(errorEvents.fingerprint, fingerprint));
}

/** Distinct unresolved errors seen in the window, and how many times. */
export async function recentErrorCount(db: Db, sinceMs: number, now = new Date()) {
  const { rows } = await db.execute<{ kinds: string; hits: string }>(sql`
    SELECT count(*)::text AS kinds, COALESCE(sum(count), 0)::text AS hits FROM error_events WHERE last_seen >= ${new Date(now.getTime() - sinceMs)} AND resolved_at IS NULL`);
  return { kinds: Number(rows[0]?.kinds ?? 0), hits: Number(rows[0]?.hits ?? 0) };
}
