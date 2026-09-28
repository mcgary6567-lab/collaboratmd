#!/usr/bin/env node
/**
 * Checks the live site from outside, the way a practice would reach it: the
 * health route (database answers), the sign-in page (the app renders, with
 * its security policy), the home page and the status page. A check that fails
 * is tried again after a pause, so a single blip does not alert anyone.
 *
 *   node scripts/live-check.mjs https://collaboratmd.vercel.app
 *
 * Exits 1 when something is still failing after the retry. With
 * OPS_ALERT_WEBHOOK_URL set, also posts {"text": ...} there (Slack incoming
 * webhooks accept this), the same shape the app's own alerts use.
 */
const base = (process.argv[2] || process.env.LIVE_URL || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("Usage: node scripts/live-check.mjs https://your-domain");
  process.exit(2);
}
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_MS = Number(process.env.LIVE_RETRY_MS ?? 30_000);

const CHECKS = [
  { path: "/api/health", expect: async (r) => r.status === 200 && (await r.json()).ok === true ? null : `HTTP ${r.status}, not {"ok":true}` },
  {
    path: "/login",
    expect: async (r) => {
      if (r.status !== 200) return `HTTP ${r.status}`;
      if (!/script-src[^;]*'nonce-/.test(r.headers.get("content-security-policy") ?? "")) return "no nonce in the Content-Security-Policy header";
      return /Sign in/.test(await r.text()) ? null : "page does not show the sign-in form";
    },
  },
  { path: "/", expect: async (r) => r.status === 200 && /CollaboratMD/.test(await r.text()) ? null : `HTTP ${r.status}` },
  { path: "/status", expect: async (r) => (r.status === 200 ? null : `HTTP ${r.status}`) },
];

async function run(check) {
  const started = Date.now();
  try {
    const r = await fetch(base + check.path, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "collaboratmd-live-check" } });
    const problem = await check.expect(r);
    return { path: check.path, ms: Date.now() - started, problem };
  } catch (e) {
    return { path: check.path, ms: Date.now() - started, problem: e?.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000} s` : String(e?.message ?? e) };
  }
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function checkOnce() {
  let results = await Promise.all(CHECKS.map(run));
  const failed = results.filter((r) => r.problem).map((r) => r.path);
  if (failed.length) {
    await sleep(RETRY_AFTER_MS);
    const again = await Promise.all(CHECKS.filter((c) => failed.includes(c.path)).map(run));
    results = results.map((r) => again.find((a) => a.path === r.path) ?? r);
  }
  console.log(new Date().toISOString());
  for (const r of results) console.log(`${r.problem ? "FAIL" : "ok  "} ${r.path} ${r.ms} ms${r.problem ? `: ${r.problem}` : ""}`);

  // The site's five-minute run (waitlist rounds, reminders at each practice's hour), started from
  // here because Vercel's plan runs its own cron once a day. Needs the site's CRON_SECRET.
  if (process.env.CRON_SECRET && !results.some((r) => r.problem)) {
    const started = Date.now();
    try {
      const r = await fetch(`${base}/api/cron/tick`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, "user-agent": "collaboratmd-live-check" }, signal: AbortSignal.timeout(60_000) });
      results.push({ path: "/api/cron/tick", ms: Date.now() - started, problem: r.ok ? null : `HTTP ${r.status}` });
      console.log(`${r.ok ? "ok  " : "FAIL"} /api/cron/tick ${Date.now() - started} ms`);
    } catch (e) {
      results.push({ path: "/api/cron/tick", ms: Date.now() - started, problem: String(e?.message ?? e) });
    }
  }

  const bad = results.filter((r) => r.problem);
  // A heartbeat service (LIVE_HEARTBEAT_URL, e.g. healthchecks.io) alerts when these pings stop, which
  // is the one failure this script cannot report itself: GitHub not running it at all.
  if (!bad.length && process.env.LIVE_HEARTBEAT_URL) await fetch(process.env.LIVE_HEARTBEAT_URL, { signal: AbortSignal.timeout(10_000) }).catch((e) => console.error("heartbeat ping failed:", e.message));
  if (bad.length) {
    const text = `CollaboratMD live check failed at ${base}: ${bad.map((r) => `${r.path} (${r.problem})`).join("; ")}`;
    const hook = process.env.OPS_ALERT_WEBHOOK_URL;
    if (hook) await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).catch((e) => console.error("alert webhook failed:", e.message));
    console.error(text);
    process.exit(1);
  }
}

// Once by default. With LIVE_WATCH_MINUTES, keeps checking every LIVE_EVERY_MINUTES (5) until that
// time is up, and stops at the first failure (which alerts): the scheduled workflow uses this, since
// GitHub starts scheduled runs hours apart at busy times.
const watchMs = Number(process.env.LIVE_WATCH_MINUTES ?? 0) * 60_000;
const everyMs = Number(process.env.LIVE_EVERY_MINUTES ?? 5) * 60_000;
const until = Date.now() + watchMs;
for (;;) {
  const started = Date.now();
  await checkOnce();
  if (Date.now() + everyMs > until) break;
  await sleep(Math.max(0, everyMs - (Date.now() - started)));
}
