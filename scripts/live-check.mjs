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

let results = await Promise.all(CHECKS.map(run));
const failed = results.filter((r) => r.problem).map((r) => r.path);
if (failed.length) {
  await new Promise((res) => setTimeout(res, RETRY_AFTER_MS));
  const again = await Promise.all(CHECKS.filter((c) => failed.includes(c.path)).map(run));
  results = results.map((r) => again.find((a) => a.path === r.path) ?? r);
}
for (const r of results) console.log(`${r.problem ? "FAIL" : "ok  "} ${r.path} ${r.ms} ms${r.problem ? `: ${r.problem}` : ""}`);

const bad = results.filter((r) => r.problem);
if (bad.length) {
  const text = `CollaboratMD live check failed at ${base}: ${bad.map((r) => `${r.path} (${r.problem})`).join("; ")}`;
  const hook = process.env.OPS_ALERT_WEBHOOK_URL;
  if (hook) await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) }).catch((e) => console.error("alert webhook failed:", e.message));
  console.error(text);
  process.exit(1);
}
