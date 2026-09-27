import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { siteOrigin } from "@/lib/origin";
import { runDaily } from "@/server/automation";
import { pruneThrottle } from "@/server/throttle";
import { expireExports } from "@/server/export-jobs";
import { sendLifecycleEmails } from "@/server/lifecycle";
import { runScheduledClosures } from "@/server/offboarding";
import { sendEmail } from "@/server/notify";
import { platformBillingReady, reportClaimUsage, syncSeats } from "@/server/subscription";
import { deliverPending } from "@/server/webhooks";

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
  // Webhook deliveries that failed are retried here as well as straight after each event.
  const webhooks = await deliverPending(db, { limit: 500 });
  await pruneThrottle(db).catch((e) => console.error("throttle prune failed", e instanceof Error ? e.message : e));
  await expireExports(db).catch((e) => console.error("export expiry failed", e instanceof Error ? e.message : e));
  const accountEmails = await sendLifecycleEmails(db, await siteOrigin(), (to, subject, text) => sendEmail(to, subject, text)).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
  const closures = await runScheduledClosures(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
  // CollaboratMD's own billing: seats follow active providers, and claims sent go to the usage meter.
  const billing = platformBillingReady()
    ? { seats: await syncSeats(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`), claims: await reportClaimUsage(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`) }
    : null;
  return Response.json({ ok: true, practices: Object.keys(result).length, result, webhooks, billing, accountEmails, closures });
}
