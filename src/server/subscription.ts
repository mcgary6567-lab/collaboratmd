/**
 * Practices paying for CollaboratMD itself, on the platform's own Stripe
 * account (separate from each practice's Stripe account for patient payments).
 *
 * Prices live in Stripe; this reads their IDs from the deployment:
 *   PLATFORM_STRIPE_SECRET_KEY, PLATFORM_STRIPE_WEBHOOK_SECRET
 *   PLATFORM_PRICE_<PLAN> and PLATFORM_PRICE_<PLAN>_ANNUAL   per provider (seat) prices,
 *       where <PLAN> is ESSENTIALS, PROFESSIONAL or BILLING_COMPANY
 *   PLATFORM_PRICE_CLAIMS + PLATFORM_CLAIM_METER_EVENT       optional per-claim metered price and its meter's event name
 * The figures on /pricing must match what those Stripe prices charge; this code
 * never sets an amount.
 *
 * Only practices that signed up on their own (self_serve) are held to a
 * subscription. After their trial, claims stop going out until someone
 * subscribes; everything else, including the data export, keeps working.
 */
import { and, desc, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { Stripe, type StripeEvent } from "@/lib/stripe";
import { TIERS } from "@/content/pricing";
import { money } from "@/lib/utils";
import { notify } from "./notifications";

const { practices, providers, claims, auditLog, platformInvoices } = schema;
type Practice = typeof practices.$inferSelect;
type Client = Pick<Stripe, "createSubscriptionCheckout" | "createPortalSession" | "updateSubscriptionItemQuantity" | "createMeterEvent">;

const env = (k: string) => process.env[k]?.trim() || null;
const planEnv = (plan: string) => plan.toUpperCase().replace(/-/g, "_");

export function platformBillingReady() {
  return !!env("PLATFORM_STRIPE_SECRET_KEY") && !!env("PLATFORM_STRIPE_WEBHOOK_SECRET");
}

export function platformClient(): Stripe {
  const key = env("PLATFORM_STRIPE_SECRET_KEY");
  if (!key) throw new Error("Subscriptions are not set up on this deployment");
  return new Stripe(key);
}

export function priceFor(plan: string, cycle: "monthly" | "annual") {
  return env(`PLATFORM_PRICE_${planEnv(plan)}${cycle === "annual" ? "_ANNUAL" : ""}`);
}

/** Which plan a Stripe price belongs to, from the same variables. */
export function planForPrice(priceId: string): string | null {
  for (const t of TIERS) for (const c of ["monthly", "annual"] as const) if (priceFor(t.id, c) === priceId) return t.id;
  return null;
}

export const ACTIVE = ["active", "trialing", "past_due"];
/** Days claims keep going out after a failed payment, while the practice updates its card. */
export const GRACE_DAYS = 7;

export type Standing = { status: string; plan: string | null; trialDaysLeft: number | null; blocked: boolean; reason: string | null; graceUntil?: Date | null };

export function standing(p: Pick<Practice, "selfServe" | "subscriptionStatus" | "trialEndsAt" | "plan" | "stripeSubscriptionId"> & { pastDueSince?: Date | null }, now = new Date()): Standing {
  const trialDaysLeft = p.trialEndsAt ? Math.max(0, Math.ceil((p.trialEndsAt.getTime() - now.getTime()) / 86_400_000)) : null;
  if (!p.selfServe) return { status: p.subscriptionStatus, plan: p.plan, trialDaysLeft: null, blocked: false, reason: null };
  if (p.stripeSubscriptionId && p.subscriptionStatus === "past_due") {
    const graceUntil = new Date((p.pastDueSince ?? now).getTime() + GRACE_DAYS * 86_400_000);
    if (graceUntil <= now) return { status: "past_due", plan: p.plan, trialDaysLeft: null, blocked: true, graceUntil, reason: "A payment failed more than a week ago, so claims are paused. An administrator can update the payment method under Settings > Subscription." };
    return { status: "past_due", plan: p.plan, trialDaysLeft: null, blocked: false, graceUntil, reason: null };
  }
  const subscribed = !!p.stripeSubscriptionId && ACTIVE.includes(p.subscriptionStatus);
  const inTrial = p.subscriptionStatus === "trialing" && !p.stripeSubscriptionId && !!p.trialEndsAt && p.trialEndsAt > now;
  if (subscribed || inTrial) return { status: p.subscriptionStatus, plan: p.plan, trialDaysLeft: inTrial ? trialDaysLeft : null, blocked: false, reason: null };
  const reason = p.subscriptionStatus === "trialing" || p.subscriptionStatus === "none"
    ? "The free trial has ended. An administrator can subscribe under Settings > Subscription to send claims again."
    : "The subscription is not active. An administrator can fix it under Settings > Subscription to send claims again.";
  return { status: p.subscriptionStatus === "trialing" ? "trial_ended" : p.subscriptionStatus, plan: p.plan, trialDaysLeft: 0, blocked: true, reason };
}

export async function startSubscriptionCheckout(db: Db, practiceId: string, input: { plan: string; cycle: "monthly" | "annual"; origin: string; email: string }, opts: { stripe?: Client; userId?: string } = {}) {
  const price = priceFor(input.plan, input.cycle);
  if (!price) throw new Error("That plan is not available to buy online yet; contact us");
  const [p] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (p.stripeSubscriptionId && ACTIVE.includes(p.subscriptionStatus)) throw new Error("This practice already has a subscription; manage it from the billing portal");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(providers).where(and(eq(providers.practiceId, practiceId), eq(providers.active, true)));
  const stripe = opts.stripe ?? platformClient();
  const session = await stripe.createSubscriptionCheckout({
    price, quantity: Math.max(1, Number(n)), meteredPrice: env("PLATFORM_PRICE_CLAIMS"),
    customer: p.stripeCustomerId, email: p.billingEmail ?? input.email, reference: practiceId,
    successUrl: `${input.origin}/settings/subscription?done=1`, cancelUrl: `${input.origin}/settings/subscription`,
    metadata: { practice_id: practiceId, plan: input.plan, cycle: input.cycle },
    idempotencyKey: `sub-${practiceId}-${input.plan}-${input.cycle}-${Math.floor(Date.now() / 600_000)}`,
  });
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "subscription_checkout", entity: "practice", entityId: practiceId, details: { plan: input.plan, cycle: input.cycle } });
  return session.url;
}

export async function billingPortalUrl(db: Db, practiceId: string, origin: string, opts: { stripe?: Client } = {}) {
  const [p] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!p.stripeCustomerId) throw new Error("There is no subscription to manage yet");
  return (await (opts.stripe ?? platformClient()).createPortalSession(p.stripeCustomerId, `${origin}/settings/subscription`)).url;
}

type SubObject = {
  id: string; status: string; customer: string; metadata?: Record<string, string>; current_period_end?: number;
  items?: { data?: { id: string; quantity?: number; current_period_end?: number; price?: { id: string; recurring?: { usage_type?: string } } }[] };
};

/** The platform webhook: records who subscribed and keeps status, plan and seats in step with Stripe. */
export async function handlePlatformEvent(db: Db, event: StripeEvent) {
  const obj = event.data.object as Record<string, unknown>;
  if (event.type === "checkout.session.completed") {
    const s = obj as { mode?: string; client_reference_id?: string; customer?: string; subscription?: string; metadata?: Record<string, string> };
    if (s.mode !== "subscription") return { handled: false };
    const practiceId = s.metadata?.practice_id ?? s.client_reference_id;
    if (!practiceId) return { handled: false };
    await db.update(practices).set({ stripeCustomerId: s.customer ?? null, stripeSubscriptionId: s.subscription ?? null, subscriptionStatus: "active", plan: s.metadata?.plan ?? undefined, claimsReportedThrough: new Date() }).where(eq(practices.id, practiceId));
    await db.insert(auditLog).values({ practiceId, action: "subscription_started", entity: "practice", entityId: practiceId, details: { plan: s.metadata?.plan } });
    return { handled: true };
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const sub = obj as SubObject;
    const byMeta = sub.metadata?.practice_id;
    const [p] = byMeta
      ? await db.select().from(practices).where(eq(practices.id, byMeta)).limit(1)
      : await db.select().from(practices).where(eq(practices.stripeSubscriptionId, sub.id)).limit(1);
    if (!p) return { handled: false };
    // A stale event for a subscription the practice has since replaced changes nothing.
    if (p.stripeSubscriptionId && p.stripeSubscriptionId !== sub.id) return { handled: false };
    const seat = sub.items?.data?.find((i) => i.price?.recurring?.usage_type !== "metered");
    const periodEnd = seat?.current_period_end ?? sub.current_period_end;
    const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
    await db.update(practices).set({
      // The grace period starts the first time it goes past due and ends when it is paid.
      pastDueSince: status === "past_due" ? p.pastDueSince ?? new Date() : null,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer,
      subscriptionStatus: status,
      plan: (seat?.price?.id && planForPrice(seat.price.id)) || p.plan,
      stripeSubscriptionItemId: seat?.id ?? p.stripeSubscriptionItemId,
      seats: seat?.quantity ?? p.seats,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : p.currentPeriodEnd,
    }).where(eq(practices.id, p.id));
    return { handled: true };
  }
  if (event.type.startsWith("invoice.")) return handleInvoiceEvent(db, event.type, obj as InvoiceObject);
  return { handled: false };
}

type InvoiceObject = {
  id: string; customer?: string; number?: string | null; status?: string | null; amount_due?: number; amount_paid?: number;
  hosted_invoice_url?: string | null; invoice_pdf?: string | null; period_start?: number; period_end?: number; created?: number;
  subscription_details?: { metadata?: Record<string, string> }; metadata?: Record<string, string>;
};

/**
 * Invoices are kept for the subscription page, and a failed payment tells
 * the practice's administrators in the app as well as by email.
 */
async function handleInvoiceEvent(db: Db, type: string, inv: InvoiceObject) {
  if (!["invoice.finalized", "invoice.paid", "invoice.payment_failed", "invoice.voided", "invoice.marked_uncollectible", "invoice.updated"].includes(type)) return { handled: false };
  const byMeta = inv.subscription_details?.metadata?.practice_id ?? inv.metadata?.practice_id;
  const [p] = byMeta
    ? await db.select().from(practices).where(eq(practices.id, byMeta)).limit(1)
    : inv.customer ? await db.select().from(practices).where(eq(practices.stripeCustomerId, inv.customer)).limit(1) : [];
  if (!p) return { handled: false };
  const status = type === "invoice.payment_failed" ? "payment_failed" : inv.status ?? "open";
  const at = (s?: number) => (s ? new Date(s * 1000) : null);
  const row = {
    practiceId: p.id, number: inv.number ?? null, status, amountDueCents: inv.amount_due ?? 0, amountPaidCents: inv.amount_paid ?? 0,
    hostedUrl: inv.hosted_invoice_url ?? null, pdfUrl: inv.invoice_pdf ?? null, periodStart: at(inv.period_start), periodEnd: at(inv.period_end),
  };
  await db.insert(platformInvoices).values({ id: inv.id, ...row, createdAt: at(inv.created) ?? new Date() }).onConflictDoUpdate({ target: platformInvoices.id, set: row });
  if (type === "invoice.payment_failed") {
    await notify(db, p.id, {
      kind: "subscription_payment_failed", dedupeKey: `invoice-failed-${inv.id}`, href: "/settings/subscription",
      title: "A CollaboratMD payment did not go through",
      body: `Invoice ${inv.number ?? ""} for ${money(inv.amount_due ?? 0)} failed. Claims keep going out for ${GRACE_DAYS} days; update the payment method under Subscription.`,
    });
  }
  return { handled: true };
}

export async function listInvoices(db: Db, practiceId: string, limit = 24) {
  return db.select().from(platformInvoices).where(eq(platformInvoices.practiceId, practiceId)).orderBy(desc(platformInvoices.createdAt)).limit(limit);
}

/** Daily: seats follow the number of active providers. */
export async function syncSeats(db: Db, opts: { stripe?: Client; now?: Date } = {}) {
  const rows = await db.select().from(practices).where(and(isNotNull(practices.stripeSubscriptionItemId), inArray(practices.subscriptionStatus, ACTIVE)));
  let changed = 0;
  for (const p of rows) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(providers).where(and(eq(providers.practiceId, p.id), eq(providers.active, true)));
    const want = Math.max(1, Number(n));
    if (want === p.seats) continue;
    const stripe = opts.stripe ?? platformClient();
    await stripe.updateSubscriptionItemQuantity(p.stripeSubscriptionItemId!, want, `seats-${p.id}-${want}-${(opts.now ?? new Date()).toISOString().slice(0, 10)}`);
    await db.update(practices).set({ seats: want }).where(eq(practices.id, p.id));
    await db.insert(auditLog).values({ practiceId: p.id, action: "subscription_seats", entity: "practice", entityId: p.id, details: { from: p.seats, to: want } });
    changed++;
  }
  return changed;
}

/** Daily: claims sent since the last report go to the per-claim meter, once. */
export async function reportClaimUsage(db: Db, opts: { stripe?: Client; now?: Date } = {}) {
  const eventName = env("PLATFORM_CLAIM_METER_EVENT");
  if (!eventName) return 0;
  const now = opts.now ?? new Date();
  const rows = await db.select().from(practices).where(and(isNotNull(practices.stripeCustomerId), inArray(practices.subscriptionStatus, ACTIVE)));
  let reported = 0;
  for (const p of rows) {
    const since = p.claimsReportedThrough ?? now;
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(claims).where(and(eq(claims.practiceId, p.id), gt(claims.submittedAt, since), lte(claims.submittedAt, now)));
    if (Number(n) > 0) {
      const stripe = opts.stripe ?? platformClient();
      await stripe.createMeterEvent({ eventName, customer: p.stripeCustomerId!, value: Number(n), identifier: `claims-${p.id}-${now.toISOString()}`, timestamp: Math.floor(now.getTime() / 1000) });
      reported += Number(n);
    }
    await db.update(practices).set({ claimsReportedThrough: now }).where(eq(practices.id, p.id));
  }
  return reported;
}
