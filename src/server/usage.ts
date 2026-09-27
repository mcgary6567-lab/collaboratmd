/**
 * Which parts of the app each practice uses: one counter per practice, page
 * and day. The page is reduced to its pattern (ids and numbers removed), so no
 * patient, claim or search term is ever stored.
 */
import { and, desc, gte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { featureUsage } = schema;

/** "/claims/3f2a.../edit?x=1" to "claims/:id/edit". Null for anything that is not an app page. */
export function featureKey(path: string): string | null {
  const clean = path.split(/[?#]/)[0];
  if (!clean.startsWith("/") || clean.startsWith("/api/") || clean.length > 300) return null;
  const parts = clean.split("/").filter(Boolean).slice(0, 4).map((s) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s) || /\d{3,}/.test(s) || s.length > 40 ? ":id" : s.toLowerCase()));
  if (!parts.length || parts.some((s) => !/^[a-z0-9:_-]+$/.test(s))) return null;
  return parts.join("/");
}

export async function recordUsage(db: Db, practiceId: string, path: string, now = new Date()) {
  const feature = featureKey(path);
  if (!feature) return false;
  await db.insert(featureUsage).values({ practiceId, feature, day: now.toISOString().slice(0, 10), count: 1 })
    .onConflictDoUpdate({ target: [featureUsage.practiceId, featureUsage.feature, featureUsage.day], set: { count: sql`${featureUsage.count} + 1` } });
  return true;
}

/** Views per feature over the last `days`, overall and per practice. */
export async function usageSummary(db: Db, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  const overall = await db.select({ feature: featureUsage.feature, views: sql<number>`sum(${featureUsage.count})::int`, practices: sql<number>`count(DISTINCT ${featureUsage.practiceId})::int` })
    .from(featureUsage).where(gte(featureUsage.day, since)).groupBy(featureUsage.feature).orderBy(desc(sql`sum(${featureUsage.count})`)).limit(40);
  const perPractice = await db.select({ practiceId: featureUsage.practiceId, feature: featureUsage.feature, views: sql<number>`sum(${featureUsage.count})::int` })
    .from(featureUsage).where(and(gte(featureUsage.day, since))).groupBy(featureUsage.practiceId, featureUsage.feature);
  const top = new Map<string, { feature: string; views: number }[]>();
  for (const r of perPractice) top.set(r.practiceId, [...(top.get(r.practiceId) ?? []), { feature: r.feature, views: Number(r.views) }]);
  for (const [k, v] of top) top.set(k, v.sort((a, b) => b.views - a.views).slice(0, 3));
  return { overall, top };
}
