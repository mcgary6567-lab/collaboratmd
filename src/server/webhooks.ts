/**
 * Outbound webhooks: a practice registers HTTPS endpoints and chooses events;
 * each event is queued per endpoint, signed, delivered, and retried with
 * backoff until the receiver answers 2xx.
 *
 * Signature (same scheme as Stripe's, so receivers can reuse their code):
 *   CollaboratMD-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 * with the endpoint's signing secret, shown once when the endpoint is created.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { seal, unseal } from "@/lib/seal";
import { appSecret } from "@/lib/app-secret";

const { webhookEndpoints, webhookDeliveries, auditLog } = schema;

export const WEBHOOK_EVENTS = [
  { type: "patient.created", description: "A patient was added (by staff, import, HL7 or the API)" },
  { type: "claim.created", description: "Charges were entered and a claim was built and scrubbed" },
  { type: "claim.submitted", description: "A claim was sent to the clearinghouse" },
  { type: "claim.status_changed", description: "A claim was accepted, rejected, paid, denied or closed" },
  { type: "payment.posted", description: "An insurance or patient payment was posted to the ledger" },
  { type: "denial.created", description: "A payer denied all or part of a claim" },
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["type"] | "ping";
const EVENT_TYPES = new Set<string>(WEBHOOK_EVENTS.map((e) => e.type));

/** Backoff after each failed attempt; after the last, the delivery is marked failed. */
const BACKOFF_MIN = [1, 5, 30, 120, 360, 720, 1440];
const TIMEOUT_MS = 10_000;

/* ------------------------------ Endpoints ------------------------------ */

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f:]*\]?)$/i;

/** HTTPS to a public host only, so a webhook cannot be aimed at the platform's own network. */
export function validateWebhookUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Enter a full URL, like https://example.com/webhooks/collaboratmd");
  }
  if (u.protocol !== "https:") throw new Error("Webhook URLs must use https");
  if (PRIVATE_HOST.test(u.hostname)) throw new Error("Webhook URLs must point to a public host");
  if (u.username || u.password) throw new Error("Put credentials in your receiver's configuration, not the URL");
  return u.toString();
}

export async function createEndpoint(db: Db, practiceId: string, input: { url: string; description?: string; events: string[] }, userId?: string) {
  const url = validateWebhookUrl(input.url);
  const events = input.events.filter((e) => EVENT_TYPES.has(e));
  if (!events.length) throw new Error("Choose at least one event");
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values({ practiceId, url, description: input.description?.trim().slice(0, 200) || null, events, secret: seal(secret, appSecret()), createdBy: userId ?? null })
    .returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "webhook_created", entity: "webhook", entityId: endpoint.id, details: { url, events } });
  return { endpoint, secret };
}

export async function setEndpointEnabled(db: Db, practiceId: string, id: string, enabled: boolean, userId?: string) {
  await db.update(webhookEndpoints).set({ enabled }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.practiceId, practiceId)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: enabled ? "webhook_enabled" : "webhook_disabled", entity: "webhook", entityId: id });
}

export async function deleteEndpoint(db: Db, practiceId: string, id: string, userId?: string) {
  await db.delete(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.practiceId, practiceId)));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "webhook_deleted", entity: "webhook", entityId: id });
}

export async function listEndpoints(db: Db, practiceId: string) {
  const rows = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.practiceId, practiceId)).orderBy(asc(webhookEndpoints.createdAt));
  const stats = await db
    .select({ endpointId: webhookDeliveries.endpointId, status: webhookDeliveries.status, n: sql<number>`count(*)::int` })
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.practiceId, practiceId), sql`${webhookDeliveries.createdAt} > now() - interval '7 days'`))
    .groupBy(webhookDeliveries.endpointId, webhookDeliveries.status);
  return rows.map(({ secret: _secret, ...e }) => ({
    ...e,
    last7: Object.fromEntries(stats.filter((s) => s.endpointId === e.id).map((s) => [s.status, Number(s.n)])) as Record<string, number>,
  }));
}

export async function listDeliveries(db: Db, practiceId: string, limit = 50) {
  return db
    .select({ delivery: webhookDeliveries, url: webhookEndpoints.url })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(eq(webhookDeliveries.practiceId, practiceId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(limit);
}

/* ------------------------------ Signing ------------------------------ */

export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/** What a receiver runs: checks the signature and that it is recent. */
export function verifySignature(secret: string, body: string, header: string | null, now = Date.now(), toleranceSec = 300) {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v1) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/* ------------------------------ Emitting ------------------------------ */

/**
 * Queues an event for every enabled endpoint of the practice that wants it,
 * then tries to deliver straight after the current request finishes. It
 * never throws: an event that cannot be queued must not undo the billing
 * action that caused it.
 */
export async function emit(db: Db, practiceId: string, type: WebhookEvent, data: Record<string, unknown>, onlyEndpointId?: string) {
  try {
    const endpoints = await db.select({ id: webhookEndpoints.id, events: webhookEndpoints.events }).from(webhookEndpoints).where(and(eq(webhookEndpoints.practiceId, practiceId), eq(webhookEndpoints.enabled, true)));
    const targets = endpoints.filter((e) => (onlyEndpointId ? e.id === onlyEndpointId : e.events.includes(type)));
    if (!targets.length) return 0;
    const eventId = `evt_${randomBytes(12).toString("base64url")}`;
    const payload = { id: eventId, type, created: new Date().toISOString(), practice_id: practiceId, data };
    await db.insert(webhookDeliveries).values(targets.map((e) => ({ practiceId, endpointId: e.id, eventId, eventType: type, payload })));
    scheduleDelivery(db, practiceId);
    return targets.length;
  } catch (e) {
    console.error("[collaboratmd] webhook emit failed", e);
    return 0;
  }
}

/** Delivers after the response when running inside a request; outside one, the daily job picks it up. */
function scheduleDelivery(db: Db, practiceId: string) {
  try {
    after(() => deliverPending(db, { practiceId }).then(() => undefined));
  } catch {
    // Not inside a request (tests, scripts): left for the next run.
  }
}

type Http = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Sends deliveries that are due. Safe to run from several places at once: each row is claimed before sending. */
export async function deliverPending(db: Db, opts: { practiceId?: string; limit?: number; http?: Http; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const http = opts.http ?? (fetch as unknown as Http);
  const due = await db
    .select({ d: webhookDeliveries, url: webhookEndpoints.url, secret: webhookEndpoints.secret })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now), ...(opts.practiceId ? [eq(webhookDeliveries.practiceId, opts.practiceId)] : [])))
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(opts.limit ?? 50);
  let delivered = 0;
  let failed = 0;
  for (const { d, url, secret } of due) {
    // Claim: push the next attempt out so a parallel run skips this row.
    const claimed = await db.update(webhookDeliveries).set({ nextAttemptAt: new Date(now.getTime() + 60_000) }).where(and(eq(webhookDeliveries.id, d.id), eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now))).returning();
    if (!claimed.length) continue;
    const body = JSON.stringify(d.payload);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await http(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "CollaboratMD-Webhooks/1",
          "CollaboratMD-Event": d.eventType,
          "CollaboratMD-Delivery": d.id,
          "CollaboratMD-Signature": signPayload(unseal(secret, appSecret()), body, Math.floor(now.getTime() / 1000)),
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      status = res.status;
      if (!res.ok) error = (await res.text()).slice(0, 300) || `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 300) : "Network error";
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await db.update(webhookDeliveries).set({ status: "delivered", attempts, lastStatus: status, lastError: null, deliveredAt: new Date() }).where(eq(webhookDeliveries.id, d.id));
      delivered++;
    } else {
      const giveUp = attempts > BACKOFF_MIN.length;
      await db.update(webhookDeliveries).set({
        status: giveUp ? "failed" : "pending",
        attempts, lastStatus: status, lastError: error,
        nextAttemptAt: new Date(now.getTime() + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] ?? 1440) * 60_000),
      }).where(eq(webhookDeliveries.id, d.id));
      failed++;
    }
  }
  return { attempted: due.length, delivered, failed };
}

/** Puts a failed or pending delivery back at the front of the queue and tries it now. */
export async function retryDelivery(db: Db, practiceId: string, id: string, http?: Http) {
  const [d] = await db.update(webhookDeliveries).set({ status: "pending", nextAttemptAt: new Date(0) }).where(and(eq(webhookDeliveries.id, id), eq(webhookDeliveries.practiceId, practiceId))).returning();
  if (!d) throw new Error("Delivery not found");
  return deliverPending(db, { practiceId, limit: 1, http });
}

/** A "ping" event to one endpoint, delivered immediately, so the receiver can be checked from the screen. */
export async function sendTestEvent(db: Db, practiceId: string, endpointId: string, http?: Http) {
  const n = await emit(db, practiceId, "ping", { message: "Test event from CollaboratMD" }, endpointId);
  if (!n) throw new Error("Endpoint not found or switched off");
  const r = await deliverPending(db, { practiceId, limit: 10, http });
  const [last] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpointId)).orderBy(desc(webhookDeliveries.createdAt)).limit(1);
  return { ...r, last };
}
