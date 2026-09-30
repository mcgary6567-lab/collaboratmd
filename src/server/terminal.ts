/**
 * Card payments at the front desk on a Stripe Terminal reader (WisePOS E or
 * S700/S710), server-driven: CollaboratMD creates the PaymentIntent and tells
 * the reader to collect it, and the reader talks to Stripe directly. Card data
 * never passes through this application.
 *
 * A payment posts to the patient's ledger only after Stripe says the
 * PaymentIntent succeeded, read from Stripe by the server (the "Check" button,
 * or the payment_intent.succeeded webhook), never on the browser's word. The
 * status change and the ledger entry happen once, however many times either
 * path runs.
 *
 * With a test key, a simulated reader can be registered and a card "tapped"
 * on it, so the whole flow can be tried without hardware.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { Stripe, stripeClient } from "@/lib/stripe";
import { practiceConfig } from "./integrations";
import { assertOwned } from "./tenancy";

const { terminalPayments, ledgerEntries, patients, practices, auditLog } = schema;
type Client = Pick<Stripe, "listReaders" | "getReader" | "createCardPresentIntent" | "processPaymentIntent" | "cancelReaderAction" | "cancelPaymentIntent" | "presentPaymentMethod" | "createLocation" | "registerReader" | "getPaymentIntent">;

async function client(db: Db, practiceId: string, injected?: Client): Promise<{ stripe: Client; test: boolean }> {
  const keys = (await practiceConfig(db, practiceId)).stripe;
  if (injected) return { stripe: injected, test: !!keys?.secretKey.includes("_test_") };
  return { stripe: stripeClient(keys), test: !!keys?.secretKey.includes("_test_") };
}

export async function listReaders(db: Db, practiceId: string, opts: { stripe?: Client } = {}) {
  const { stripe, test } = await client(db, practiceId, opts.stripe);
  return { readers: (await stripe.listReaders()).data, test };
}

/** Test mode only: a location from the practice address and a simulated WisePOS E there. */
export async function createSimulatedReader(db: Db, practiceId: string, opts: { stripe?: Client; userId?: string } = {}) {
  const { stripe, test } = await client(db, practiceId, opts.stripe);
  if (!test) throw new Error("Simulated readers exist only in Stripe test mode; connect a test key to try one");
  const [p] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const location = await stripe.createLocation({ displayName: p.name.slice(0, 40), line1: p.address1, city: p.city, state: p.state, postalCode: p.zip.slice(0, 5) });
  const reader = await stripe.registerReader({ registrationCode: "simulated-wpe", location: location.id, label: "Simulated front desk reader" });
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "terminal_reader_simulated", entity: "practice", entityId: practiceId, details: { reader: reader.id } });
  return reader;
}

export async function startTerminalPayment(db: Db, practiceId: string, input: { patientId: string; amountCents: number; readerId: string }, opts: { stripe?: Client; userId?: string } = {}) {
  await assertOwned(db, practiceId, "patient", input.patientId);
  if (!Number.isInteger(input.amountCents) || input.amountCents < 50 || input.amountCents > 1_000_000) throw new Error("Enter an amount between $0.50 and $10,000");
  if (!/^tmr_[A-Za-z0-9]+$/.test(input.readerId)) throw new Error("Choose a reader");
  const { stripe } = await client(db, practiceId, opts.stripe);
  const id = randomUUID();
  const [p] = await db.select({ mrn: patients.mrn }).from(patients).where(eq(patients.id, input.patientId)).limit(1);
  const intent = await stripe.createCardPresentIntent({
    amountCents: input.amountCents,
    description: `Patient payment, account ${p.mrn}`,
    metadata: { practice_id: practiceId, patient_id: input.patientId, terminal_payment_id: id },
    idempotencyKey: `terminal-${id}`,
  });
  const [row] = await db.insert(terminalPayments).values({ id, practiceId, patientId: input.patientId, readerId: input.readerId, paymentIntentId: intent.id, amountCents: input.amountCents, createdBy: opts.userId ?? null }).returning();
  try {
    await stripe.processPaymentIntent(input.readerId, intent.id);
  } catch (e) {
    // The reader never got it (busy, offline): release the intent so nothing can charge later.
    await stripe.cancelPaymentIntent(intent.id).catch(() => {});
    await db.update(terminalPayments).set({ status: "failed", failure: e instanceof Error ? e.message.slice(0, 200) : "Reader error", completedAt: new Date() }).where(eq(terminalPayments.id, id));
    throw e;
  }
  return row;
}

/** Posts the payment once: only the call that moves it from waiting to succeeded writes the ledger entry. */
export async function settleTerminalPayment(db: Db, paymentIntentId: string, expectedPracticeId?: string) {
  const [row] = await db.select().from(terminalPayments).where(eq(terminalPayments.paymentIntentId, paymentIntentId)).limit(1);
  if (!row) return null;
  if (expectedPracticeId && row.practiceId !== expectedPracticeId) throw new Error("Payment belongs to another practice");
  const claimed = await db.update(terminalPayments).set({ status: "succeeded", completedAt: new Date() }).where(and(eq(terminalPayments.id, row.id), eq(terminalPayments.status, "waiting"))).returning();
  if (!claimed.length) return row;
  const [entry] = await db.insert(ledgerEntries).values({ practiceId: row.practiceId, patientId: row.patientId, type: "patient_payment", paymentMethod: "terminal", amountCents: row.amountCents, note: "Patient payment (card, front desk reader)", postedBy: row.createdBy }).returning();
  await db.update(terminalPayments).set({ ledgerEntryId: entry.id }).where(eq(terminalPayments.id, row.id));
  await db.insert(auditLog).values({ practiceId: row.practiceId, userId: row.createdBy, action: "terminal_payment", entity: "patient", entityId: row.patientId, details: { amountCents: row.amountCents, paymentIntent: paymentIntentId } });
  return { ...claimed[0], ledgerEntryId: entry.id };
}

/** Asks Stripe where the payment stands and records it. */
export async function checkTerminalPayment(db: Db, practiceId: string, id: string, opts: { stripe?: Client } = {}) {
  const [row] = await db.select().from(terminalPayments).where(and(eq(terminalPayments.id, id), eq(terminalPayments.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Payment not found");
  if (row.status !== "waiting") return row;
  const { stripe } = await client(db, practiceId, opts.stripe);
  const intent = await stripe.getPaymentIntent(row.paymentIntentId);
  if (intent.status === "succeeded") return (await settleTerminalPayment(db, row.paymentIntentId, practiceId))!;
  const reader = await stripe.getReader(row.readerId);
  const a = reader.action;
  if (a?.type === "process_payment_intent" && a.process_payment_intent?.payment_intent === row.paymentIntentId && a.status === "failed") {
    // Declined or cancelled on the reader. The same intent could be retried, but a fresh start is clearer at a desk.
    await stripe.cancelPaymentIntent(row.paymentIntentId).catch(() => {});
    const [failed] = await db.update(terminalPayments).set({ status: "failed", failure: (a.failure_message || a.failure_code || "Declined").slice(0, 200), completedAt: new Date() }).where(and(eq(terminalPayments.id, id), eq(terminalPayments.status, "waiting"))).returning();
    return failed ?? row;
  }
  return row;
}

export async function cancelTerminalPayment(db: Db, practiceId: string, id: string, opts: { stripe?: Client } = {}) {
  const [row] = await db.select().from(terminalPayments).where(and(eq(terminalPayments.id, id), eq(terminalPayments.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Payment not found");
  if (row.status !== "waiting") throw new Error(`This payment already ${row.status}`);
  const { stripe } = await client(db, practiceId, opts.stripe);
  await stripe.cancelReaderAction(row.readerId).catch(() => {});
  const intent = await stripe.getPaymentIntent(row.paymentIntentId);
  if (intent.status === "succeeded") return (await settleTerminalPayment(db, row.paymentIntentId, practiceId))!;
  await stripe.cancelPaymentIntent(row.paymentIntentId);
  const [done] = await db.update(terminalPayments).set({ status: "canceled", completedAt: new Date() }).where(and(eq(terminalPayments.id, id), eq(terminalPayments.status, "waiting"))).returning();
  return done ?? row;
}

/** Test mode: present the default test card to the simulated reader. */
export async function simulateTap(db: Db, practiceId: string, id: string, opts: { stripe?: Client } = {}) {
  const [row] = await db.select().from(terminalPayments).where(and(eq(terminalPayments.id, id), eq(terminalPayments.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Payment not found");
  const { stripe, test } = await client(db, practiceId, opts.stripe);
  if (!test) throw new Error("Only simulated readers in test mode can be tapped from here");
  await stripe.presentPaymentMethod(row.readerId);
  return checkTerminalPayment(db, practiceId, id, opts);
}

export async function recentTerminalPayments(db: Db, practiceId: string, patientId?: string) {
  return db.select().from(terminalPayments)
    .where(patientId ? and(eq(terminalPayments.practiceId, practiceId), eq(terminalPayments.patientId, patientId)) : eq(terminalPayments.practiceId, practiceId))
    .orderBy(desc(terminalPayments.createdAt)).limit(20);
}
