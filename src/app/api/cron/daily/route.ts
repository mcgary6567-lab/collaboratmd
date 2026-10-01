import { cronRefusal } from "@/lib/cron-auth";
import { getDb } from "@/db";
import { siteOrigin } from "@/lib/origin";
import { runDaily } from "@/server/automation";
import { pruneThrottle } from "@/server/throttle";
import { expireExports } from "@/server/export-jobs";
import { applyRetention } from "@/server/retention";
import { sendLifecycleEmails } from "@/server/lifecycle";
import { runScheduledClosures } from "@/server/offboarding";
import { sendEmail } from "@/server/notify";
import { platformBillingReady, reportClaimUsage, syncSeats } from "@/server/subscription";
import { deliverPending } from "@/server/webhooks";
import { beat, checkTickStale } from "@/server/tick";
import { alertStaleCodeSets } from "@/server/code-set-calendar";
import { alertOperators } from "@/server/ops-alerts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Vercel Cron calls this daily (vercel.json) with
 * `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET set, the job
 * does not run, so nobody can trigger patient messages by guessing the URL.
 */
export async function GET(req: Request) {
  const refused = cronRefusal(req);
  if (refused) return refused;
  const db = await getDb();
  await beat(db, "daily");
  const result = await runDaily(db, await siteOrigin());
  // The five-minute runs come from outside; if they have stopped, the operators hear it here.
  const ticks = await checkTickStale(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
  // Webhook deliveries that failed are retried here as well as straight after each event.
  const webhooks = await deliverPending(db, { limit: 500 });
  await pruneThrottle(db).catch((e) => console.error("throttle prune failed", e instanceof Error ? e.message : e));
  await expireExports(db).catch((e) => console.error("export expiry failed", e instanceof Error ? e.message : e));
  const accountEmails = await sendLifecycleEmails(db, await siteOrigin(), (to, subject, text) => sendEmail(to, subject, text)).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
  const closures = await runScheduledClosures(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
  const retention = await applyRetention(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
  // CMS releases on a fixed calendar; operators hear (at most weekly) when a code set is due or overdue.
  const codeSets = await alertStaleCodeSets(db, alertOperators).catch((e) => `failed: ${e instanceof Error ? e.message : e}`);
  // CollaboratMD's own billing: seats follow active providers, and claims sent go to the usage meter.
  const billing = platformBillingReady()
    ? { seats: await syncSeats(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`), claims: await reportClaimUsage(db).catch((e) => `failed: ${e instanceof Error ? e.message : e}`) }
    : null;
  return Response.json({ ok: true, practices: Object.keys(result).length, result, webhooks, billing, accountEmails, closures, retention, ticks, codeSets });
}
