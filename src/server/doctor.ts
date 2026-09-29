/**
 * The integration doctor: every connected service checked end to end, as far
 * as it can be without affecting anyone. Read-only requests everywhere; the
 * two checks that create something (a Stripe payment intent that is cancelled
 * at once, and a Lob letter) run only with test keys, where nothing is charged
 * or mailed. Results are kept, so "it worked on Tuesday" is on record.
 */
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { validateX12 } from "@/lib/edi/validate";
import { PROBES, practiceConfig, clearConfigCache, type IntegrationConfig, type Provider } from "./integrations";
import { getFhir, testFhir } from "./fhir";
import { smsRegistrationStatus } from "./sms-registration";

const { integrationChecks, claims, automationRuns, practices } = schema;

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckResult = { id: string; service: string; name: string; status: CheckStatus; detail: string };
export type DoctorHttp = (url: string, init: { method?: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;
type Ctx = { db: Db; practiceId: string; cfg: IntegrationConfig; http: DoctorHttp; now: Date };
type Check = { id: string; service: string; name: string; run(c: Ctx): Promise<Omit<CheckResult, "id" | "service" | "name">> };

const pass = (detail: string) => ({ status: "pass" as const, detail });
const warn = (detail: string) => ({ status: "warn" as const, detail });
const fail = (detail: string) => ({ status: "fail" as const, detail });
const skip = (detail: string) => ({ status: "skip" as const, detail });
const basic = (user: string, pw = "") => `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

function probe(provider: Provider): Check["run"] {
  return async (c) => {
    if (!c.cfg[provider]) return skip("Not connected");
    const r = await PROBES[provider](c.cfg, c.http);
    return r.ok ? pass(r.message) : fail(r.message);
  };
}

export const CHECKS: Check[] = [
  { id: "stedi.key", service: "Stedi", name: "API key accepted", run: probe("stedi") },
  {
    id: "stedi.inbound", service: "Stedi", name: "Can read remittances and acknowledgments", async run(c) {
      if (!c.cfg.stedi) return skip("Not connected");
      const since = new Date(c.now.getTime() - 3_600_000).toISOString();
      const r = await c.http(`https://core.us.stedi.com/2023-08-01/polling/transactions?startDateTime=${encodeURIComponent(since)}&pageSize=1`, { method: "GET", headers: { Authorization: c.cfg.stedi.apiKey } });
      return r.ok ? pass("Polling for ERAs and 277CAs works") : fail(`Stedi answered ${r.status} to the polling request; ERAs will not arrive automatically`);
    },
  },
  {
    id: "claims.selfcheck", service: "Claims", name: "Recent claim files pass the structural checks", async run(c) {
      const rows = await c.db.select({ controlNumber: claims.controlNumber, edi: claims.edi837 }).from(claims)
        .where(and(eq(claims.practiceId, c.practiceId), isNotNull(claims.edi837))).orderBy(desc(claims.submittedAt)).limit(25);
      if (!rows.length) return skip("No claims sent yet");
      const bad = rows.map((r) => ({ n: r.controlNumber, e: validateX12(r.edi!).errors })).filter((r) => r.e.length);
      return bad.length ? fail(`${bad.length} of the last ${rows.length} files have problems, e.g. ${bad[0].n}: ${bad[0].e[0]}`) : pass(`The last ${rows.length} claim files are well formed`);
    },
  },
  { id: "stripe.key", service: "Stripe", name: "Secret key accepted", run: probe("stripe") },
  {
    id: "stripe.webhook", service: "Stripe", name: "Webhook signing secret saved", async run(c) {
      if (!c.cfg.stripe) return skip("Not connected");
      return c.cfg.stripe.webhookSecret ? pass("Payments can be confirmed and posted") : fail("Without the webhook signing secret, portal payments are never confirmed or posted");
    },
  },
  {
    id: "stripe.write", service: "Stripe", name: "Can create and cancel a payment (test mode)", async run(c) {
      if (!c.cfg.stripe) return skip("Not connected");
      if (!c.cfg.stripe.secretKey.includes("_test_")) return skip("Skipped with a live key, so no live payment is created");
      const h = { Authorization: `Bearer ${c.cfg.stripe.secretKey}`, "Content-Type": "application/x-www-form-urlencoded" };
      const r = await c.http("https://api.stripe.com/v1/payment_intents", { method: "POST", headers: h, body: form({ amount: "100", currency: "usd", "payment_method_types[]": "card", description: "Integration doctor check" }) });
      if (!r.ok) return fail(`Stripe refused to create a test payment (${r.status})`);
      const pi = (await r.json()) as { id: string };
      const x = await c.http(`https://api.stripe.com/v1/payment_intents/${pi.id}/cancel`, { method: "POST", headers: h, body: "" });
      return x.ok ? pass(`Created and cancelled ${pi.id}`) : warn(`Created ${pi.id} but could not cancel it (${x.status})`);
    },
  },
  {
    id: "stripe.terminal", service: "Stripe", name: "Card readers", async run(c) {
      if (!c.cfg.stripe) return skip("Not connected");
      const r = await c.http("https://api.stripe.com/v1/terminal/readers?limit=20", { method: "GET", headers: { Authorization: `Bearer ${c.cfg.stripe.secretKey}` } });
      if (!r.ok) return fail(`Stripe answered ${r.status} for card readers`);
      const readers = ((await r.json()) as { data?: { status: string | null }[] }).data ?? [];
      if (!readers.length) return skip("No readers registered");
      const online = readers.filter((x) => x.status === "online").length;
      return online ? pass(`${online} of ${readers.length} reader${readers.length === 1 ? "" : "s"} online`) : warn(`${readers.length} reader${readers.length === 1 ? "" : "s"} registered, none online`);
    },
  },
  { id: "twilio.key", service: "Twilio", name: "Account and number", run: probe("twilio") },
  {
    id: "twilio.registration", service: "Twilio", name: "Carrier registration (A2P 10DLC or toll-free)", async run(c) {
      if (!c.cfg.twilio) return skip("Not connected");
      const r = await smsRegistrationStatus(c.cfg.twilio, c.http);
      if (r.status === "approved") return pass(r.detail);
      if (r.status === "pending") return warn(`${r.detail}: texts may be filtered until it is approved`);
      return fail(`${r.detail}. US carriers block unregistered business texts; see Settings, Integrations, Text message registration`);
    },
  },
  { id: "resend.key", service: "Resend", name: "Key and sending domain", run: probe("resend") },
  { id: "lob.key", service: "Lob", name: "API key accepted", run: probe("lob") },
  {
    id: "lob.render", service: "Lob", name: "Renders a letter (test mode)", async run(c) {
      if (!c.cfg.lob) return skip("Not connected");
      if (!c.cfg.lob.apiKey.startsWith("test_")) return skip("Skipped with a live key, so nothing is printed or mailed");
      const [p] = await c.db.select().from(practices).where(eq(practices.id, c.practiceId)).limit(1);
      if (!p.address1 || !p.zip) return warn("Add the practice address first; letters need a return address");
      const addr = { address_line1: p.address1, address_city: p.city, address_state: p.state, address_zip: p.zip.slice(0, 5), address_country: "US" };
      const r = await c.http("https://api.lob.com/v1/letters", {
        method: "POST", headers: { Authorization: basic(c.cfg.lob.apiKey), "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Integration doctor check", to: { company: p.name.slice(0, 40), ...addr }, from: { company: p.name.slice(0, 40), ...addr }, file: "<html><body><p>Integration check from CollaboratMD. Test mode: not printed or mailed.</p></body></html>", color: false, use_type: "operational", address_placement: "insert_blank_page" }),
      });
      if (!r.ok) return fail(`Lob refused the test letter (${r.status}): ${(await r.text()).slice(0, 160)}`);
      return pass(`Rendered ${((await r.json()) as { id?: string }).id ?? "a letter"}; see it in Lob's dashboard`);
    },
  },
  { id: "anthropic.key", service: "Claude", name: "API key accepted", run: probe("anthropic") },
  {
    id: "fhir.connect", service: "EHR (FHIR)", name: "Server reachable with our credentials", async run(c) {
      if (!(await getFhir(c.db, c.practiceId))) return skip("Not connected");
      return pass(await testFhir(c.db, c.practiceId, c.http));
    },
  },
  {
    id: "platform.daily", service: "CollaboratMD", name: "Daily job ran in the last day", async run(c) {
      if (!process.env.CRON_SECRET?.trim() && process.env.VERCEL) return fail("CRON_SECRET is not set on the deployment, so the daily job never runs");
      const [last] = await c.db.select({ at: automationRuns.ranAt }).from(automationRuns).where(eq(automationRuns.practiceId, c.practiceId)).orderBy(desc(automationRuns.ranAt)).limit(1);
      if (!last) return warn("The daily job has not run for this practice yet");
      const hours = Math.round((c.now.getTime() - last.at.getTime()) / 3_600_000);
      return hours <= 26 ? pass(`Last ran ${hours} hour${hours === 1 ? "" : "s"} ago`) : warn(`Last ran ${hours} hours ago`);
    },
  },
];

/** Runs every check (or one) and records the results. */
export async function runDoctor(db: Db, practiceId: string, opts: { http?: DoctorHttp; now?: Date; userId?: string; only?: string } = {}): Promise<CheckResult[]> {
  clearConfigCache(practiceId);
  const ctx: Ctx = { db, practiceId, cfg: await practiceConfig(db, practiceId), http: opts.http ?? (fetch as unknown as DoctorHttp), now: opts.now ?? new Date() };
  const out: CheckResult[] = [];
  for (const check of CHECKS.filter((c) => !opts.only || c.id === opts.only)) {
    let r: Omit<CheckResult, "id" | "service" | "name">;
    try {
      r = await check.run(ctx);
    } catch (e) {
      r = fail(e instanceof Error ? e.message.slice(0, 200) : "Check failed");
    }
    out.push({ id: check.id, service: check.service, name: check.name, ...r });
    await db.insert(integrationChecks).values({ practiceId, checkId: check.id, status: r.status, detail: r.detail.slice(0, 500), ranAt: ctx.now, ranBy: opts.userId ?? null });
  }
  return out;
}

/** The latest result of each check, with when it last passed. */
export async function latestChecks(db: Db, practiceId: string) {
  const { rows } = await db.execute(sql`
    SELECT DISTINCT ON (check_id) check_id, status, detail, ran_at,
      (SELECT max(ran_at) FROM integration_checks p WHERE p.practice_id = c.practice_id AND p.check_id = c.check_id AND p.status = 'pass') AS last_pass
    FROM integration_checks c WHERE practice_id = ${practiceId}
    ORDER BY check_id, ran_at DESC`);
  return new Map((rows as { check_id: string; status: CheckStatus; detail: string; ran_at: string | Date; last_pass: string | Date | null }[]).map((r) => [r.check_id, { status: r.status, detail: r.detail, ranAt: new Date(r.ran_at), lastPass: r.last_pass ? new Date(r.last_pass) : null }]));
}
