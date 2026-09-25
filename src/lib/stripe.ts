/**
 * Stripe over its REST API (https://docs.stripe.com/api). Card details never
 * touch this application: patients pay on Stripe's hosted Checkout page, and
 * a card saved for autopay is held by Stripe, referenced here by id.
 *
 * Each practice connects its own Stripe account in Settings → Integrations
 * (or the deployment sets STRIPE_SECRET_KEY). Payments are confirmed by the
 * webhook, never by the browser returning to the site.
 * Built from Stripe's published API reference and tested with a stubbed HTTP
 * layer; not yet exercised against a live Stripe account.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.stripe.com/v1";

type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type StripeKeys = { secretKey: string; webhookSecret: string | null } | null;

/** Payments need both keys: the secret key starts them and the webhook secret is how they are confirmed. */
export function stripeReady(keys: StripeKeys) {
  return !!keys?.secretKey && !!keys.webhookSecret;
}

/** Stripe's form encoding: nested keys in brackets. */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => out.push(...(typeof item === "object" ? formEncode(item as Record<string, unknown>, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`])));
    else if (typeof v === "object") out.push(...formEncode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

export class Stripe {
  constructor(private readonly key: string, private readonly http: Http = fetch as unknown as Http) {}

  private async call<T>(method: "GET" | "POST", path: string, params?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
    const res = await this.http(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: params ? formEncode(params).join("&") : undefined,
    });
    const body = (await res.json()) as T & { error?: { message?: string; code?: string } };
    if (!res.ok) throw new Error(`Stripe: ${body.error?.message ?? `HTTP ${res.status}`}`);
    return body;
  }

  /** A hosted Checkout page for one payment; optionally saves the card for later off-session charges. */
  createCheckout(p: { amountCents: number; description: string; successUrl: string; cancelUrl: string; metadata: Record<string, string>; email?: string | null; saveCard?: boolean; idempotencyKey: string }) {
    return this.call<{ id: string; url: string }>("POST", "/checkout/sessions", {
      mode: "payment",
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      customer_email: p.email || undefined,
      customer_creation: p.saveCard ? "always" : undefined,
      line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: p.amountCents, product_data: { name: p.description } } }],
      metadata: p.metadata,
      payment_intent_data: { metadata: p.metadata, setup_future_usage: p.saveCard ? "off_session" : undefined },
    }, p.idempotencyKey);
  }

  getPaymentIntent(id: string) {
    return this.call<{ id: string; status: string; payment_method: string | null; customer: string | null }>("GET", `/payment_intents/${encodeURIComponent(id)}`);
  }

  getPaymentMethod(id: string) {
    return this.call<{ id: string; card?: { brand: string; last4: string; exp_month: number; exp_year: number } }>("GET", `/payment_methods/${encodeURIComponent(id)}`);
  }

  /** Charges a saved card without the patient present (autopay). */
  chargeSaved(p: { customer: string; paymentMethod: string; amountCents: number; description: string; metadata: Record<string, string>; idempotencyKey: string }) {
    return this.call<{ id: string; status: string; last_payment_error?: { message?: string } }>("POST", "/payment_intents", {
      amount: p.amountCents, currency: "usd", customer: p.customer, payment_method: p.paymentMethod,
      off_session: "true", confirm: "true", description: p.description, metadata: p.metadata,
    }, p.idempotencyKey);
  }
}

export function stripeClient(keys: StripeKeys, http?: Http) {
  if (!keys?.secretKey) throw new Error("Online payments are not set up: connect Stripe in Settings → Integrations");
  return new Stripe(keys.secretKey, http);
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Verifies a webhook's Stripe-Signature header: HMAC-SHA256 of
 * "<timestamp>.<raw body>" with the endpoint secret, within a tolerance so
 * an old request cannot be replayed.
 */
export function verifyWebhook(rawBody: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300): StripeEvent {
  if (!header) throw new Error("Missing Stripe-Signature");
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]).filter((kv) => kv.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((kv) => kv.trim().startsWith("v1=")).map((kv) => kv.trim().slice(3));
  if (!t || !sigs.length) throw new Error("Malformed Stripe-Signature");
  if (Math.abs(now / 1000 - t) > toleranceSec) throw new Error("Stripe webhook timestamp outside tolerance");
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const ok = sigs.some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error("Stripe webhook signature does not match");
  return JSON.parse(rawBody) as StripeEvent;
}
