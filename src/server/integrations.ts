/**
 * Outside services a practice connects from Settings → Integrations:
 * the clearinghouse (Stedi), card payments (Stripe), texting (Twilio), email
 * (Resend) and AI (Anthropic).
 *
 * Each practice has its own keys, so a billing company's clients each keep
 * their own Stripe account and clearinghouse enrollment. A practice that has
 * not connected a service falls back to the deployment's environment
 * variables, so a single-practice install can still be configured there.
 *
 * Secrets are encrypted with AES-256-GCM (lib/seal) under a key derived from
 * AUTH_SECRET before they are stored; the screen only ever shows their last
 * four characters. Every change and test is written to the audit log.
 */
import { and, eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@/db";
import { schema } from "@/db";
import { seal, unseal } from "@/lib/seal";
import { appSecret as signingKey } from "@/lib/app-secret";

const { practiceIntegrations, auditLog } = schema;

export type Provider = "stedi" | "stripe" | "twilio" | "resend" | "anthropic";
export const PROVIDER_KEYS: Provider[] = ["stedi", "stripe", "twilio", "resend", "anthropic"];

type Field = { key: string; label: string; placeholder?: string; help?: string; pattern?: RegExp; patternHint?: string; optional?: boolean; kind?: "text" | "boolean" };

export const PROVIDERS: Record<Provider, {
  name: string;
  category: string;
  purpose: string;
  unlocks: string[];
  signup: string;
  secrets: Field[];
  settings: Field[];
}> = {
  stedi: {
    name: "Stedi",
    category: "Clearinghouse",
    purpose: "Sends claims, eligibility checks and claim status inquiries to real payers, and brings back acknowledgments and remittances.",
    unlocks: ["Live 837P claims", "Real-time eligibility (270/271)", "Claim status (276/277)", "ERAs (835)"],
    signup: "https://www.stedi.com/app/settings/api-keys",
    secrets: [{ key: "apiKey", label: "API key", placeholder: "Stedi API key", help: "Stedi portal → Settings → API keys. Use a production key once your payer enrollments are approved." }],
    settings: [],
  },
  stripe: {
    name: "Stripe",
    category: "Card payments",
    purpose: "Lets patients pay balances by card from the portal and check-in, and charges saved cards for payment plans.",
    unlocks: ["Portal card payments", "Copay at check-in", "Autopay for plans"],
    signup: "https://dashboard.stripe.com/apikeys",
    secrets: [
      { key: "secretKey", label: "Secret key", placeholder: "sk_live_… or sk_test_…", pattern: /^(sk|rk)_(live|test)_[A-Za-z0-9]{10,}$/, patternHint: "starts with sk_live_, sk_test_ or rk_" },
      { key: "webhookSecret", label: "Webhook signing secret", placeholder: "whsec_…", pattern: /^whsec_[A-Za-z0-9+/=]{10,}$/, patternHint: "starts with whsec_", help: "Add the webhook URL shown on this card in Stripe → Developers → Webhooks, then paste its signing secret here." },
    ],
    settings: [],
  },
  twilio: {
    name: "Twilio",
    category: "Text messages",
    purpose: "Texts appointment reminders, balance reminders, pay links and final notices to patients who agreed to texts.",
    unlocks: ["Appointment reminders by text", "Text-to-pay links", "Final notices by text"],
    signup: "https://console.twilio.com/",
    secrets: [{ key: "authToken", label: "Auth token", placeholder: "32-character auth token", pattern: /^[a-f0-9]{32}$/i, patternHint: "32 letters and digits" }],
    settings: [
      { key: "accountSid", label: "Account SID", placeholder: "AC…", pattern: /^AC[a-f0-9]{32}$/i, patternHint: "starts with AC followed by 32 characters" },
      { key: "from", label: "Sending number", placeholder: "+15125550123", pattern: /^\+1\d{10}$/, patternHint: "a US number like +15125550123", help: "A Twilio number registered for A2P 10DLC messaging." },
    ],
  },
  resend: {
    name: "Resend",
    category: "Email",
    purpose: "Emails reminders, pay links, check-in links, final notices and the weekly report.",
    unlocks: ["Reminder and pay-link emails", "Weekly report", "Scheduled reports"],
    signup: "https://resend.com/api-keys",
    secrets: [{ key: "apiKey", label: "API key", placeholder: "re_…", pattern: /^re_[A-Za-z0-9_]{10,}$/, patternHint: "starts with re_" }],
    settings: [
      { key: "from", label: "Send from", placeholder: "Summit Health Billing <billing@yourpractice.com>", help: "An address on a domain you verified in Resend.", optional: true },
    ],
  },
  anthropic: {
    name: "Claude (Anthropic)",
    category: "AI",
    purpose: "Writes plain-English denial explanations and appeal drafts from codes, matches import columns, and runs the overnight denial agent.",
    unlocks: ["AI denial explanations", "AI appeal drafts", "Denial agent", "AI note coding (with BAA)"],
    signup: "https://console.anthropic.com/settings/keys",
    secrets: [{ key: "apiKey", label: "API key", placeholder: "sk-ant-…", pattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/, patternHint: "starts with sk-ant-" }],
    settings: [
      { key: "phiAllowed", label: "We have a business associate agreement (BAA) with Anthropic covering this key", kind: "boolean", help: "Only then are full visit notes, which contain patient information, sent for coding suggestions. Everything else sends codes only.", optional: true },
    ],
  },
};

export type IntegrationConfig = {
  stedi: { apiKey: string } | null;
  stripe: { secretKey: string; webhookSecret: string | null } | null;
  twilio: { accountSid: string; authToken: string; from: string } | null;
  resend: { apiKey: string; from: string | null } | null;
  anthropic: { apiKey: string; phiAllowed: boolean } | null;
  sources: Record<Provider, "practice" | "environment" | "off">;
};

const env = (k: string) => process.env[k]?.trim() || undefined;

/** The deployment-wide defaults from environment variables. */
export function envConfig(): IntegrationConfig {
  const stediKey = env("CLEARINGHOUSE")?.toLowerCase() === "stedi" ? env("STEDI_API_KEY") : undefined;
  const cfg: IntegrationConfig = {
    stedi: stediKey ? { apiKey: stediKey } : null,
    stripe: env("STRIPE_SECRET_KEY") ? { secretKey: env("STRIPE_SECRET_KEY")!, webhookSecret: env("STRIPE_WEBHOOK_SECRET") ?? null } : null,
    twilio: env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM") ? { accountSid: env("TWILIO_ACCOUNT_SID")!, authToken: env("TWILIO_AUTH_TOKEN")!, from: env("TWILIO_FROM")! } : null,
    resend: env("RESEND_API_KEY") ? { apiKey: env("RESEND_API_KEY")!, from: env("CONTACT_FROM_EMAIL") ?? null } : null,
    anthropic: env("ANTHROPIC_API_KEY") ? { apiKey: env("ANTHROPIC_API_KEY")!, phiAllowed: env("AI_PHI_ALLOWED") === "1" } : null,
    sources: { stedi: "off", stripe: "off", twilio: "off", resend: "off", anthropic: "off" },
  };
  for (const p of PROVIDER_KEYS) cfg.sources[p] = cfg[p] ? "environment" : "off";
  return cfg;
}

type Row = typeof practiceIntegrations.$inferSelect;

function readSecrets(row: Row): Record<string, string> {
  if (!row.secrets) return {};
  try {
    return JSON.parse(unseal(row.secrets, signingKey())) as Record<string, string>;
  } catch {
    // Sealed under a different AUTH_SECRET: treat as not connected rather than failing every request.
    return {};
  }
}

function fromRow(provider: Provider, row: Row): IntegrationConfig[Provider] {
  const s = readSecrets(row);
  const st = row.settings ?? {};
  const str = (k: string) => (typeof st[k] === "string" && (st[k] as string).trim()) || null;
  switch (provider) {
    case "stedi": return s.apiKey ? { apiKey: s.apiKey } : null;
    case "stripe": return s.secretKey ? { secretKey: s.secretKey, webhookSecret: s.webhookSecret || null } : null;
    case "twilio": return s.authToken && str("accountSid") && str("from") ? { accountSid: str("accountSid")!, authToken: s.authToken, from: str("from")! } : null;
    case "resend": return s.apiKey ? { apiKey: s.apiKey, from: str("from") } : null;
    case "anthropic": return s.apiKey ? { apiKey: s.apiKey, phiAllowed: st.phiAllowed === true } : null;
  }
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; rows: Row[] }>();

/**
 * The services this practice can use right now. A connected service uses
 * the practice's keys; one the practice switched off stays off; one it never
 * touched falls back to the environment. Cached briefly because it runs on
 * most requests; saving clears this instance's cache at once and other
 * server instances pick the change up within 30 seconds.
 */
export async function practiceConfig(db: Db, practiceId: string): Promise<IntegrationConfig> {
  const hit = cache.get(practiceId);
  let rows: Row[];
  if (hit && Date.now() - hit.at < TTL_MS) rows = hit.rows;
  else {
    rows = await db.select().from(practiceIntegrations).where(eq(practiceIntegrations.practiceId, practiceId));
    cache.set(practiceId, { at: Date.now(), rows });
  }
  const cfg = envConfig();
  for (const row of rows) {
    const p = row.provider as Provider;
    if (!PROVIDER_KEYS.includes(p)) continue;
    const resolved = row.enabled ? fromRow(p, row) : null;
    (cfg as Record<Provider, unknown>)[p] = resolved;
    cfg.sources[p] = resolved ? "practice" : "off";
  }
  return cfg;
}

export function clearConfigCache(practiceId?: string) {
  if (practiceId) cache.delete(practiceId);
  else cache.clear();
}

const hint = (v: string) => (v.length <= 4 ? "••••" : `••••${v.slice(-4)}`);

export type SaveInput = { enabled: boolean; settings: Record<string, string | boolean>; secrets: Record<string, string> };

/**
 * Saves a practice's connection. A blank secret field keeps the stored value,
 * so an admin can change the sending number without re-pasting the token.
 */
export async function saveIntegration(db: Db, practiceId: string, provider: Provider, input: SaveInput, userId?: string) {
  const def = PROVIDERS[provider];
  if (!def) throw new Error("Unknown service");
  const [existing] = await db.select().from(practiceIntegrations).where(and(eq(practiceIntegrations.practiceId, practiceId), eq(practiceIntegrations.provider, provider))).limit(1);
  const secrets = existing ? readSecrets(existing) : {};
  const hints = { ...(existing?.secretHints ?? {}) };
  for (const f of def.secrets) {
    const v = input.secrets[f.key]?.trim();
    if (!v) continue;
    if (f.pattern && !f.pattern.test(v)) throw new Error(`${def.name} ${f.label.toLowerCase()} looks wrong: it ${f.patternHint}`);
    secrets[f.key] = v;
    hints[f.key] = hint(v);
  }
  const settings: Record<string, string | boolean> = {};
  for (const f of def.settings) {
    const raw = input.settings[f.key];
    if (f.kind === "boolean") {
      settings[f.key] = raw === true || raw === "on" || raw === "true";
      continue;
    }
    const v = typeof raw === "string" ? raw.trim() : "";
    if (v && f.pattern && !f.pattern.test(v)) throw new Error(`${def.name} ${f.label.toLowerCase()} looks wrong: it should be ${f.patternHint}`);
    if (v) settings[f.key] = v.slice(0, 300);
  }
  if (input.enabled) {
    const missing = [...def.secrets.filter((f) => !f.optional && !secrets[f.key]), ...def.settings.filter((f) => !f.optional && f.kind !== "boolean" && !settings[f.key])].map((f) => f.label);
    // The Stripe webhook secret can come after the key: payments stay off until it is there, but the key can be tested first.
    const blocking = missing.filter((m) => !(provider === "stripe" && m === "Webhook signing secret"));
    if (blocking.length) throw new Error(`Enter the ${blocking.join(" and ").toLowerCase()} to connect ${def.name}`);
  }
  const values = {
    enabled: input.enabled,
    settings,
    secrets: Object.keys(secrets).length ? seal(JSON.stringify(secrets), signingKey()) : null,
    secretHints: hints,
    updatedBy: userId ?? null,
    updatedAt: new Date(),
  };
  if (existing) await db.update(practiceIntegrations).set(values).where(eq(practiceIntegrations.id, existing.id));
  else await db.insert(practiceIntegrations).values({ practiceId, provider, ...values });
  clearConfigCache(practiceId);
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "integration_saved", entity: "integration", entityId: provider, details: { enabled: input.enabled, secretsChanged: def.secrets.filter((f) => input.secrets[f.key]?.trim()).map((f) => f.key) } });
}

/** Forgets the practice's keys; the service falls back to the environment defaults, if any. */
export async function disconnectIntegration(db: Db, practiceId: string, provider: Provider, userId?: string) {
  await db.delete(practiceIntegrations).where(and(eq(practiceIntegrations.practiceId, practiceId), eq(practiceIntegrations.provider, provider)));
  clearConfigCache(practiceId);
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "integration_disconnected", entity: "integration", entityId: provider });
}

export async function listIntegrations(db: Db, practiceId: string) {
  const [rows, cfg] = await Promise.all([
    db.select().from(practiceIntegrations).where(eq(practiceIntegrations.practiceId, practiceId)),
    practiceConfig(db, practiceId),
  ]);
  return PROVIDER_KEYS.map((p) => {
    const row = rows.find((r) => r.provider === p) ?? null;
    return {
      provider: p,
      def: PROVIDERS[p],
      source: cfg.sources[p],
      connected: !!cfg[p],
      row: row && { enabled: row.enabled, settings: row.settings, secretHints: row.secretHints, lastTestAt: row.lastTestAt, lastTestOk: row.lastTestOk, lastTestMessage: row.lastTestMessage, updatedAt: row.updatedAt },
      extra: p === "stripe" && cfg.stripe && !cfg.stripe.webhookSecret ? "Add the webhook signing secret so payments are confirmed and posted." : null,
    };
  });
}

/* ------------------------------ Connection tests ------------------------------ */

type Http = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
type TestResult = { ok: boolean; message: string };

async function readJson(res: { text(): Promise<string> }) {
  try {
    return JSON.parse(await res.text()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** One read-only request per service that proves the keys work, without sending anything to anyone. */
export const PROBES: Record<Provider, (cfg: IntegrationConfig, http: Http) => Promise<TestResult>> = {
  async stedi(cfg, http) {
    const res = await http("https://payers.us.stedi.com/2024-04-01/payers", { method: "GET", headers: { Authorization: cfg.stedi!.apiKey } });
    if (res.status === 401 || res.status === 403) return { ok: false, message: "Stedi rejected the API key." };
    if (!res.ok) return { ok: false, message: `Stedi answered ${res.status}.` };
    return { ok: true, message: "Connected to Stedi. Claims, eligibility and status inquiries now go to real payers." };
  },
  async stripe(cfg, http) {
    const res = await http("https://api.stripe.com/v1/balance", { method: "GET", headers: { Authorization: `Bearer ${cfg.stripe!.secretKey}` } });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, message: `Stripe rejected the key: ${(body.error as { message?: string })?.message ?? res.status}` };
    const mode = body.livemode ? "live mode" : "test mode";
    return { ok: true, message: `Connected to Stripe in ${mode}.${cfg.stripe!.webhookSecret ? "" : " Add the webhook signing secret before taking payments."}` };
  },
  async twilio(cfg, http) {
    const t = cfg.twilio!;
    const res = await http(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}.json`, { method: "GET", headers: { Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64")}` } });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, message: `Twilio rejected the account SID or auth token (${res.status}).` };
    return { ok: body.status === "active", message: body.status === "active" ? `Connected to Twilio account "${String(body.friendly_name ?? "")}". Texts will come from ${t.from}.` : `Twilio account status is ${String(body.status)}.` };
  },
  async resend(cfg, http) {
    const res = await http("https://api.resend.com/domains", { method: "GET", headers: { Authorization: `Bearer ${cfg.resend!.apiKey}` } });
    const body = await readJson(res);
    if (res.status === 401 && String(body.name ?? "").includes("restricted")) return { ok: true, message: "Key accepted (a sending-only key). Send a test email to confirm the sender address." };
    if (!res.ok) return { ok: false, message: `Resend rejected the key (${res.status}).` };
    const domains = ((body.data as { name: string; status: string }[]) ?? []);
    const from = cfg.resend!.from;
    const fromDomain = from?.match(/@([^>\s]+)/)?.[1]?.toLowerCase();
    const d = fromDomain ? domains.find((x) => x.name.toLowerCase() === fromDomain) : null;
    if (fromDomain && !d) return { ok: false, message: `The key works, but ${fromDomain} is not a domain in this Resend account.` };
    if (d && d.status !== "verified") return { ok: false, message: `The key works, but ${d.name} is ${d.status} in Resend, not verified.` };
    return { ok: true, message: `Connected to Resend (${domains.filter((x) => x.status === "verified").length} verified domain${domains.length === 1 ? "" : "s"}).` };
  },
  async anthropic(cfg) {
    try {
      const client = new Anthropic({ apiKey: cfg.anthropic!.apiKey });
      await client.models.list({ limit: 1 });
      return { ok: true, message: `Connected to Claude.${cfg.anthropic!.phiAllowed ? " Visit-note coding is on (BAA confirmed)." : " Codes only; visit-note coding stays off until a BAA is confirmed."}` };
    } catch (e) {
      return { ok: false, message: e instanceof Anthropic.APIError && (e.status === 401 || e.status === 403) ? "Anthropic rejected the API key." : `Could not reach Anthropic: ${e instanceof Error ? e.message.slice(0, 120) : "unknown error"}` };
    }
  },
};

export async function testIntegration(db: Db, practiceId: string, provider: Provider, userId?: string, http: Http = fetch as unknown as Http): Promise<TestResult> {
  clearConfigCache(practiceId);
  const cfg = await practiceConfig(db, practiceId);
  let result: TestResult;
  if (!cfg[provider]) result = { ok: false, message: `${PROVIDERS[provider].name} is not connected. Enter the keys and save first.` };
  else {
    try {
      result = await PROBES[provider](cfg, http);
    } catch (e) {
      result = { ok: false, message: `Could not reach ${PROVIDERS[provider].name}: ${e instanceof Error ? e.message.slice(0, 120) : "network error"}` };
    }
  }
  await db.update(practiceIntegrations).set({ lastTestAt: new Date(), lastTestOk: result.ok, lastTestMessage: result.message }).where(and(eq(practiceIntegrations.practiceId, practiceId), eq(practiceIntegrations.provider, provider)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "integration_tested", entity: "integration", entityId: provider, details: { ok: result.ok } });
  return result;
}
