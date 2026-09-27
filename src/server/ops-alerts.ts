import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { sendEmail } from "./notify";
import { sendSms, toE164 } from "./messaging";

/**
 * Tells the people running the platform when something breaks, instead of
 * waiting for someone to open /ops/errors: a new kind of server error (usually
 * a bad deploy) or a burst of errors. Each kind of alert has a cooldown, so a
 * failing page sends one message, not one per request.
 *
 * Where alerts go (all optional, set on the deployment):
 *   PLATFORM_ADMIN_EMAILS  email, through the deployment's RESEND_API_KEY
 *   OPS_ALERT_PHONES       text message, through the deployment's TWILIO_* settings
 *   OPS_ALERT_WEBHOOK_URL  a JSON POST of {"text": ...}, which Slack and similar incoming webhooks accept
 *   OPS_ALERT_THRESHOLD    errors in 10 minutes that count as a burst (default 25)
 *
 * Error text is already redacted by server/errors.ts before it gets here, and
 * alerts carry only that text and the route, never request data.
 */

export const WINDOW_MS = 10 * 60_000;
export const COOLDOWN_MS = { burst: 60 * 60_000, new: 30 * 60_000 } as const;

export type AlertSender = {
  email(to: string, subject: string, text: string): Promise<boolean>;
  sms(to: string, text: string): Promise<boolean>;
  webhook(url: string, text: string): Promise<boolean>;
};

const env = (k: string) => process.env[k]?.trim() || "";
const list = (k: string) => env(k).split(",").map((s) => s.trim()).filter(Boolean);
export const threshold = () => Math.max(1, Number(env("OPS_ALERT_THRESHOLD")) || 25);

const realSender: AlertSender = {
  email: (to, subject, text) => sendEmail(to, subject, text),
  async sms(to, text) {
    const sid = env("TWILIO_ACCOUNT_SID"), token = env("TWILIO_AUTH_TOKEN"), from = env("TWILIO_FROM");
    if (!sid || !token || !from) return false;
    return (await sendSms({ accountSid: sid, authToken: token, from }, to, text)).ok;
  },
  async webhook(url, text) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  },
};

export function alertChannels() {
  return { emails: list("PLATFORM_ADMIN_EMAILS"), phones: list("OPS_ALERT_PHONES").map(toE164).filter((p): p is string => !!p), webhook: env("OPS_ALERT_WEBHOOK_URL") };
}

/** Counts one error in the rolling window; returns the count so far in the window. */
async function countError(db: Db, now: Date): Promise<number> {
  const since = new Date(now.getTime() - WINDOW_MS).toISOString();
  const { rows } = await db.execute(sql`
    INSERT INTO ops_alerts (kind, window_start, hits) VALUES ('errors', ${now.toISOString()}::timestamptz, 1)
    ON CONFLICT (kind) DO UPDATE SET
      hits = CASE WHEN ops_alerts.window_start <= ${since}::timestamptz THEN 1 ELSE ops_alerts.hits + 1 END,
      window_start = CASE WHEN ops_alerts.window_start <= ${since}::timestamptz THEN ${now.toISOString()}::timestamptz ELSE ops_alerts.window_start END
    RETURNING hits`);
  return Number((rows[0] as { hits: number | string }).hits);
}

/** Claims the right to send this kind of alert now; false while its cooldown runs. One statement, so two servers cannot both send. */
async function claim(db: Db, kind: keyof typeof COOLDOWN_MS, now: Date): Promise<boolean> {
  const before = new Date(now.getTime() - COOLDOWN_MS[kind]).toISOString();
  const { rows } = await db.execute(sql`
    INSERT INTO ops_alerts (kind, last_sent_at) VALUES (${`alert:${kind}`}, ${now.toISOString()}::timestamptz)
    ON CONFLICT (kind) DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at
      WHERE ops_alerts.last_sent_at IS NULL OR ops_alerts.last_sent_at <= ${before}::timestamptz
    RETURNING kind`);
  return rows.length > 0;
}

async function deliver(subject: string, text: string, send: AlertSender) {
  const c = alertChannels();
  const results = await Promise.all([
    ...c.emails.map((e) => send.email(e, subject, text)),
    ...c.phones.map((p) => send.sms(p, `${subject}. ${text.split("\n")[0]}`.slice(0, 300))),
    ...(c.webhook ? [send.webhook(c.webhook, `*${subject}*\n${text}`)] : []),
  ]);
  return results.filter(Boolean).length;
}

/**
 * Called after each recorded server error. Returns what it sent, for tests and logs.
 * `origin` is the site address for the link to the error list.
 */
export async function noteError(
  db: Db,
  e: { fingerprint: string; message: string; routePath?: string | null },
  opts: { now?: Date; origin?: string; send?: AlertSender } = {},
): Promise<{ sent: "new" | "burst" | null; delivered: number }> {
  const now = opts.now ?? new Date();
  const c = alertChannels();
  if (!c.emails.length && !c.phones.length && !c.webhook) return { sent: null, delivered: 0 };
  const send = opts.send ?? realSender;
  const base = opts.origin ?? (env("APP_URL") || (env("VERCEL_PROJECT_PRODUCTION_URL") ? `https://${env("VERCEL_PROJECT_PRODUCTION_URL")}` : ""));
  const link = `${base.replace(/\/$/, "")}/ops/errors`;
  const hits = await countError(db, now);

  const { rows } = await db.execute(sql`SELECT count FROM error_events WHERE fingerprint = ${e.fingerprint}`);
  const isNew = Number((rows[0] as { count?: number } | undefined)?.count ?? 0) === 1;
  if (isNew && (await claim(db, "new", now))) {
    const delivered = await deliver("CollaboratMD: new server error", `${e.message}\nWhere: ${e.routePath ?? "unknown route"}\n${link}`, send);
    return { sent: "new", delivered };
  }
  if (hits >= threshold() && (await claim(db, "burst", now))) {
    const delivered = await deliver("CollaboratMD: error burst", `${hits} server errors in the last 10 minutes. Latest: ${e.message} (${e.routePath ?? "unknown route"})\n${link}`, send);
    return { sent: "burst", delivered };
  }
  return { sent: null, delivered: 0 };
}

/** A plain notice to operators on every configured channel (no cooldown). Keep patient details out of `text`. */
export async function alertOperators(subject: string, text: string, send: AlertSender = realSender) {
  return deliver(subject, text, send);
}
