import { getDb } from "@/db";
import { cronRefusal } from "@/lib/cron-auth";
import { siteOrigin } from "@/lib/origin";
import { runTick } from "@/server/tick";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Every five minutes, from the live-check workflow on GitHub (Vercel's plan
 * allows its own cron once a day). Same CRON_SECRET as the daily job. See
 * server/tick.ts for what it does.
 */
export async function POST(req: Request) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const db = await getDb();
  const result = await runTick(db, await siteOrigin());
  return Response.json({ ok: true, result });
}
