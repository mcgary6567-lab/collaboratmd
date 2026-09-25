import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { siteOrigin } from "@/lib/origin";
import { runDaily } from "@/server/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron calls this daily (vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET set, the job
 * does not run, so nobody can trigger patient messages by guessing the URL.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return new Response("CRON_SECRET is not set", { status: 503 });
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("Unauthorized", { status: 401 });
  const db = await getDb();
  const result = await runDaily(db, await siteOrigin());
  return Response.json({ ok: true, practices: Object.keys(result).length, result });
}
