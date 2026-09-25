/**
 * The patient portal: balance, statements, receipts, payments, autopay for a
 * payment plan, and reporting new insurance.
 *
 * Access is by link, as with check-in: a random token stored only as a hash,
 * the patient's date of birth before anything is shown, and a lock after
 * five wrong answers. A link lasts 30 days; sending a new one retires the old.
 *
 * Payments run through Stripe's hosted Checkout. The ledger is only posted
 * when Stripe's signed webhook confirms the payment, and exactly once, keyed
 * on Stripe's session id.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { normalizeDob } from "./checkin";
import { buildStatementDetail, patientBalanceCents, plansForPatient, recordPlanPayment } from "./billing";
import { createTask } from "./work";
import { stripeClient, stripeReady, type Stripe, type StripeEvent } from "@/lib/stripe";
import { practiceConfig } from "./integrations";
import { emit } from "./webhooks";

const { portalLinks, onlinePayments, savedCards, patients, practices, ledgerEntries, statements } = schema;

export const MAX_ATTEMPTS = 5;
export const LINK_DAYS = 30;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createPortalLink(db: Db, practiceId: string, patientId: string, userId?: string, purpose: "portal" | "pay" = "portal") {
  const [p] = await db.select().from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  await db.update(portalLinks).set({ revokedAt: new Date() }).where(and(eq(portalLinks.patientId, patientId), isNull(portalLinks.revokedAt)));
  const token = randomBytes(24).toString("base64url");
  const [link] = await db
    .insert(portalLinks)
    .values({ practiceId, patientId, tokenHash: hash(token), purpose, expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000), createdBy: userId ?? null })
    .returning();
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "create_portal_link", entity: "patient", entityId: patientId });
  return { link, token, path: `/portal/${token}`, patient: p };
}

export type PortalState =
  | { state: "invalid" }
  | { state: "expired" | "locked"; practiceName: string; practicePhone: string | null }
  | { state: "open"; link: typeof portalLinks.$inferSelect; practiceName: string; practicePhone: string | null };

export async function openPortal(db: Db, token: string): Promise<PortalState> {
  if (!token || token.length < 20 || token.length > 64) return { state: "invalid" };
  const [row] = await db
    .select({ link: portalLinks, practiceName: practices.name, practicePhone: practices.phone })
    .from(portalLinks)
    .innerJoin(practices, eq(practices.id, portalLinks.practiceId))
    .where(eq(portalLinks.tokenHash, hash(token)))
    .limit(1);
  if (!row || row.link.revokedAt) return { state: "invalid" };
  if (row.link.lockedAt) return { state: "locked", practiceName: row.practiceName, practicePhone: row.practicePhone };
  if (row.link.expiresAt.getTime() < Date.now()) return { state: "expired", practiceName: row.practiceName, practicePhone: row.practicePhone };
  return { state: "open", link: row.link, practiceName: row.practiceName, practicePhone: row.practicePhone };
}

export async function verifyPortalDob(db: Db, token: string, dobInput: string): Promise<{ ok: true; linkId: string } | { ok: false; message: string }> {
  const o = await openPortal(db, token);
  if (o.state !== "open") return { ok: false, message: "This link can no longer be used. Please call the office." };
  if (o.link.failedAttempts >= MAX_ATTEMPTS) return { ok: false, message: "This link is locked. Please call the office." };
  const [p] = await db.select({ dob: patients.dob }).from(patients).where(eq(patients.id, o.link.patientId)).limit(1);
  const dob = normalizeDob(dobInput);
  if (dob && p && dob === p.dob) {
    await db.update(portalLinks).set({ lastUsedAt: new Date() }).where(eq(portalLinks.id, o.link.id));
    return { ok: true, linkId: o.link.id };
  }
  const [u] = await db.update(portalLinks).set({ failedAttempts: sql`${portalLinks.failedAttempts} + 1` }).where(eq(portalLinks.id, o.link.id)).returning();
  if (u.failedAttempts >= MAX_ATTEMPTS) {
    await db.update(portalLinks).set({ lockedAt: new Date() }).where(eq(portalLinks.id, o.link.id));
    return { ok: false, message: "That date of birth does not match. For your security this link is now locked; please call the office." };
  }
  const left = MAX_ATTEMPTS - u.failedAttempts;
  return { ok: false, message: `That date of birth does not match our records. ${left} ${left === 1 ? "try" : "tries"} left.` };
}

/** Everything the portal shows, for a verified link. */
export async function portalData(db: Db, linkId: string) {
  const [row] = await db
    .select({ link: portalLinks, patient: patients, practice: practices })
    .from(portalLinks)
    .innerJoin(patients, eq(patients.id, portalLinks.patientId))
    .innerJoin(practices, eq(practices.id, portalLinks.practiceId))
    .where(eq(portalLinks.id, linkId))
    .limit(1);
  if (!row) return null;
  const { patient, practice } = row;
  const [balance, stmts, plans, payments, cards, detail] = await Promise.all([
    patientBalanceCents(db, patient.id),
    db.select().from(statements).where(and(eq(statements.patientId, patient.id), sql`${statements.status} <> 'void'`)).orderBy(desc(statements.createdAt)).limit(12),
    plansForPatient(db, practice.id, patient.id),
    db.select().from(ledgerEntries).where(and(eq(ledgerEntries.patientId, patient.id), eq(ledgerEntries.type, "patient_payment"))).orderBy(desc(ledgerEntries.postedAt)).limit(24),
    db.select().from(savedCards).where(and(eq(savedCards.patientId, patient.id), isNull(savedCards.removedAt))),
    buildStatementDetail(db, patient.id),
  ]);
  const onlinePayments = stripeReady((await practiceConfig(db, practice.id)).stripe);
  return { patient, practice, balance, statements: stmts, plans, payments, cards, visits: detail.visits.filter((v) => v.youOweCents > 0), onlinePayments };
}

/**
 * Starts a card payment on Stripe's hosted page. `planId` applies it to a
 * payment plan; `autopay` saves the card to pay that plan's installments
 * automatically.
 */
export async function startPortalPayment(
  db: Db,
  linkId: string,
  input: { amountCents: number; planId?: string | null; autopay?: boolean; origin: string; token: string },
  client?: Pick<Stripe, "createCheckout">,
) {
  const data = await portalData(db, linkId);
  if (!data) throw new Error("This link can no longer be used");
  const stripe = client ?? stripeClient((await practiceConfig(db, data.practice.id)).stripe);
  if (!Number.isInteger(input.amountCents) || input.amountCents < 100) throw new Error("Enter at least $1.00");
  if (input.amountCents > Math.max(data.balance, 0) && !input.planId) throw new Error("That is more than you owe");
  const plan = input.planId ? data.plans.find((p) => p.plan.id === input.planId && ["active", "defaulted"].includes(p.plan.status)) : null;
  if (input.planId && !plan) throw new Error("That payment plan is not active");
  const [pay] = await db
    .insert(onlinePayments)
    .values({ practiceId: data.practice.id, patientId: data.patient.id, planId: plan?.plan.id ?? null, amountCents: input.amountCents, source: "portal" })
    .returning();
  const back = `${input.origin}/portal/${input.token}`;
  const session = await stripe.createCheckout({
    amountCents: input.amountCents,
    description: `${data.practice.name}: payment on account`,
    successUrl: `${back}?paid=${pay.id}`,
    cancelUrl: back,
    email: data.patient.email,
    saveCard: !!(plan && input.autopay),
    metadata: { payment_id: pay.id, practice_id: data.practice.id, autopay: plan && input.autopay ? "1" : "0" },
    idempotencyKey: `portal-${pay.id}`,
  });
  await db.update(onlinePayments).set({ providerRef: session.id }).where(eq(onlinePayments.id, pay.id));
  return { url: session.url, paymentId: pay.id };
}

/**
 * Applies a Stripe webhook event. checkout.session.completed with a paid
 * session posts the payment (to its plan, if it has one) and saves the card
 * for autopay when asked; a repeated event changes nothing.
 */
export async function handleStripeEvent(db: Db, event: StripeEvent, client?: Pick<Stripe, "getPaymentIntent" | "getPaymentMethod">, expectedPracticeId?: string) {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return { handled: false };
  const s = event.data.object as { id: string; payment_status?: string; metadata?: Record<string, string>; payment_intent?: string | null; customer?: string | null };
  if (s.payment_status !== "paid") return { handled: false };
  const [pay] = await db.select().from(onlinePayments).where(and(eq(onlinePayments.provider, "stripe"), eq(onlinePayments.providerRef, s.id))).limit(1);
  if (!pay) throw new Error(`No payment for Stripe session ${s.id}`);
  // A practice's webhook only ever settles that practice's payments.
  if (expectedPracticeId && pay.practiceId !== expectedPracticeId) throw new Error("Payment belongs to another practice");
  if (pay.status === "paid") return { handled: true, duplicate: true };

  // Claim the row first, so two deliveries of the same event cannot both post.
  const claimed = await db.update(onlinePayments).set({ status: "paid", paidAt: new Date() }).where(and(eq(onlinePayments.id, pay.id), eq(onlinePayments.status, "pending"))).returning();
  if (!claimed.length) return { handled: true, duplicate: true };

  if (pay.planId) {
    await recordPlanPayment(db, pay.practiceId, pay.planId, pay.amountCents, "card online");
  } else {
    const [entry] = await db.insert(ledgerEntries).values({ practiceId: pay.practiceId, patientId: pay.patientId, type: "patient_payment", amountCents: pay.amountCents, note: `Online card payment (${s.id.slice(-8)})` }).returning();
    await db.update(onlinePayments).set({ ledgerEntryId: entry.id }).where(eq(onlinePayments.id, pay.id));
  }

  if (s.metadata?.autopay === "1" && pay.planId && s.payment_intent) {
    const stripe = client ?? stripeClient((await practiceConfig(db, pay.practiceId)).stripe);
    const pi = await stripe.getPaymentIntent(s.payment_intent);
    if (pi.payment_method && (pi.customer ?? s.customer)) {
      const pm = await stripe.getPaymentMethod(pi.payment_method);
      await db.update(savedCards).set({ removedAt: new Date() }).where(and(eq(savedCards.patientId, pay.patientId), isNull(savedCards.removedAt)));
      await db.insert(savedCards).values({
        practiceId: pay.practiceId, patientId: pay.patientId, providerCustomer: (pi.customer ?? s.customer)!, providerMethod: pi.payment_method,
        brand: pm.card?.brand ?? null, last4: pm.card?.last4 ?? null, expMonth: pm.card?.exp_month ?? null, expYear: pm.card?.exp_year ?? null, autopayPlanId: pay.planId,
      });
    }
  }
  await db.insert(schema.auditLog).values({ practiceId: pay.practiceId, userId: null, action: "online_payment", entity: "patient", entityId: pay.patientId, details: { amountCents: pay.amountCents, planId: pay.planId } });
  await emit(db, pay.practiceId, "payment.posted", { type: "patient_payment", patient_id: pay.patientId, amount_cents: pay.amountCents, source: pay.source, plan_id: pay.planId });
  return { handled: true, duplicate: false };
}

/**
 * The copay at online check-in: a card payment on Stripe's hosted page for
 * the expected copay, posted to the patient's account when Stripe confirms
 * it. Only offered once the patient has verified their date of birth.
 */
export async function startCheckinCopay(
  db: Db,
  linkId: string,
  input: { origin: string; token: string },
  client?: Pick<Stripe, "createCheckout">,
) {
  const { loadCheckin } = await import("./checkin");
  const data = await loadCheckin(db, linkId);
  if (!data) throw new Error("This check-in link can no longer be used");
  if (!data.copayCents || data.copayCents < 100) throw new Error("There is no copay to pay online");
  const cfg = await practiceConfig(db, data.link.practiceId);
  if (!client && !stripeReady(cfg.stripe)) throw new Error("Online payment is not available; pay at the front desk");
  const stripe = client ?? stripeClient(cfg.stripe);
  const [pay] = await db
    .insert(onlinePayments)
    .values({ practiceId: data.link.practiceId, patientId: data.patient.id, amountCents: data.copayCents, source: "checkin" })
    .returning();
  const back = `${input.origin}/check-in/${input.token}`;
  const session = await stripe.createCheckout({
    amountCents: data.copayCents,
    description: `${data.practiceName}: copay for your visit`,
    successUrl: `${back}?paid=1`,
    cancelUrl: `${back}?paid=0`,
    email: data.patient.email,
    saveCard: false,
    metadata: { payment_id: pay.id, practice_id: data.link.practiceId, autopay: "0" },
    idempotencyKey: `checkin-${pay.id}`,
  });
  await db.update(onlinePayments).set({ providerRef: session.id }).where(eq(onlinePayments.id, pay.id));
  return { url: session.url, paymentId: pay.id };
}

/** Patient-reported insurance change: a task for the front desk, not a silent chart edit. */
export async function reportInsurance(db: Db, linkId: string, input: { payerName: string; memberId: string; groupNumber?: string }) {
  const data = await portalData(db, linkId);
  if (!data) throw new Error("This link can no longer be used");
  if (!input.payerName.trim() || !input.memberId.trim()) throw new Error("Enter the insurance company and member ID from your card");
  await createTask(db, data.practice.id, {
    title: `Patient reported new insurance: ${input.payerName.trim().slice(0, 60)}`,
    entityType: "patient", entityId: data.patient.id,
    note: `Member ID ${input.memberId.trim().slice(0, 40)}${input.groupNumber?.trim() ? `, group ${input.groupNumber.trim().slice(0, 40)}` : ""}. Reported through the patient portal; verify and update the chart.`,
    priority: "high",
  });
}

/**
 * Autopay: charges each saved card for its plan's installments that are due
 * and unpaid. Safe to run daily; the idempotency key stops a double charge.
 */
export async function chargeAutopay(db: Db, practiceId: string, client?: Pick<Stripe, "chargeSaved">, today = new Date().toISOString().slice(0, 10)) {
  const stripe = client ?? stripeClient((await practiceConfig(db, practiceId)).stripe);
  const cards = await db.select().from(savedCards).where(and(eq(savedCards.practiceId, practiceId), isNull(savedCards.removedAt), sql`${savedCards.autopayPlanId} IS NOT NULL`));
  let charged = 0;
  let failed = 0;
  for (const card of cards) {
    const plans = await plansForPatient(db, practiceId, card.patientId);
    const plan = plans.find((p) => p.plan.id === card.autopayPlanId && ["active", "defaulted"].includes(p.plan.status));
    if (!plan) continue;
    const due = plan.installments.filter((i) => i.dueDate <= today && i.status !== "paid").reduce((a, i) => a + (i.amountCents - i.paidCents), 0);
    if (due <= 0) continue;
    const [pay] = await db.insert(onlinePayments).values({ practiceId, patientId: card.patientId, planId: plan.plan.id, amountCents: due, source: "autopay" }).returning();
    try {
      const pi = await stripe.chargeSaved({
        customer: card.providerCustomer, paymentMethod: card.providerMethod, amountCents: due, description: "Payment plan installment",
        metadata: { payment_id: pay.id }, idempotencyKey: `autopay-${plan.plan.id}-${today}`,
      });
      if (pi.status === "succeeded") {
        await db.update(onlinePayments).set({ providerRef: pi.id, status: "paid", paidAt: new Date() }).where(eq(onlinePayments.id, pay.id));
        await recordPlanPayment(db, practiceId, plan.plan.id, due, `autopay card ${card.last4 ?? ""}`.trim());
        charged++;
      } else {
        await db.update(onlinePayments).set({ providerRef: pi.id, status: "failed", failure: pi.last_payment_error?.message ?? pi.status }).where(eq(onlinePayments.id, pay.id));
        failed++;
      }
    } catch (e) {
      await db.update(onlinePayments).set({ status: "failed", failure: e instanceof Error ? e.message.slice(0, 300) : "error" }).where(eq(onlinePayments.id, pay.id));
      failed++;
    }
  }
  return { charged, failed };
}
