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

  /* Terminal, server-driven (https://docs.stripe.com/terminal/payments/collect-card-payment?terminal-sdk-platform=server-driven). */

  listReaders() {
    return this.call<{ data: TerminalReader[] }>("GET", "/terminal/readers?limit=100");
  }

  getReader(id: string) {
    return this.call<TerminalReader>("GET", `/terminal/readers/${encodeURIComponent(id)}`);
  }

  /** A card-present PaymentIntent, captured automatically when the reader authorizes it. */
  createCardPresentIntent(p: { amountCents: number; description: string; metadata: Record<string, string>; idempotencyKey: string }) {
    return this.call<{ id: string; status: string }>("POST", "/payment_intents", {
      amount: p.amountCents, currency: "usd", payment_method_types: ["card_present"], capture_method: "automatic",
      description: p.description, metadata: p.metadata,
    }, p.idempotencyKey);
  }

  processPaymentIntent(readerId: string, paymentIntentId: string) {
    return this.call<TerminalReader>("POST", `/terminal/readers/${encodeURIComponent(readerId)}/process_payment_intent`, { payment_intent: paymentIntentId, process_config: { enable_customer_cancellation: "true" } });
  }

  cancelReaderAction(readerId: string) {
    return this.call<TerminalReader>("POST", `/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`);
  }

  cancelPaymentIntent(id: string) {
    return this.call<{ id: string; status: string }>("POST", `/payment_intents/${encodeURIComponent(id)}/cancel`);
  }

  /** Test mode only: a simulated reader "sees" a card (defaults to a Visa test card). */
  presentPaymentMethod(readerId: string) {
    return this.call<TerminalReader>("POST", `/test_helpers/terminal/readers/${encodeURIComponent(readerId)}/present_payment_method`);
  }

  createLocation(p: { displayName: string; line1: string; city: string; state: string; postalCode: string }) {
    return this.call<{ id: string }>("POST", "/terminal/locations", { display_name: p.displayName, address: { line1: p.line1, city: p.city, state: p.state, postal_code: p.postalCode, country: "US" } });
  }

  /* Subscriptions (CollaboratMD billing its own customers, on the platform's Stripe account). */

  /** Hosted Checkout for a subscription: a per-seat price, plus a metered price when given (metered prices take no quantity). */
  createSubscriptionCheckout(p: { price: string; quantity: number; meteredPrice?: string | null; customer?: string | null; email?: string | null; reference: string; successUrl: string; cancelUrl: string; metadata: Record<string, string>; idempotencyKey: string }) {
    return this.call<{ id: string; url: string }>("POST", "/checkout/sessions", {
      mode: "subscription",
      success_url: p.successUrl,
      cancel_url: p.cancelUrl,
      customer: p.customer || undefined,
      customer_email: p.customer ? undefined : p.email || undefined,
      client_reference_id: p.reference,
      line_items: [{ price: p.price, quantity: p.quantity }, ...(p.meteredPrice ? [{ price: p.meteredPrice }] : [])],
      metadata: p.metadata,
      subscription_data: { metadata: p.metadata },
    }, p.idempotencyKey);
  }

  createPortalSession(customer: string, returnUrl: string) {
    return this.call<{ id: string; url: string }>("POST", "/billing_portal/sessions", { customer, return_url: returnUrl });
  }

  updateSubscriptionItemQuantity(itemId: string, quantity: number, idempotencyKey: string) {
    return this.call<{ id: string; quantity: number }>("POST", `/subscription_items/${encodeURIComponent(itemId)}`, { quantity }, idempotencyKey);
  }

  /** Usage for a billing meter; `identifier` makes a retry count once. */
  createMeterEvent(p: { eventName: string; customer: string; value: number; identifier: string; timestamp: number }) {
    return this.call<{ identifier: string }>("POST", "/billing/meter_events", { event_name: p.eventName, identifier: p.identifier, timestamp: p.timestamp, payload: { stripe_customer_id: p.customer, value: String(p.value) } });
  }

  /** Registers a reader; the code "simulated-wpe" makes a simulated WisePOS E in test mode. */
  registerReader(p: { registrationCode: string; location: string; label?: string }) {
    return this.call<TerminalReader>("POST", "/terminal/readers", { registration_code: p.registrationCode, location: p.location, label: p.label });
  }
}

export type TerminalReader = {
  id: string;
  label: string | null;
  device_type: string;
  status: string | null;
  livemode: boolean;
  action: { type: string; status: string; failure_code: string | null; failure_message: string | null; process_payment_intent?: { payment_intent: string } } | null;
};

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
