/**
 * Card on file. A patient who authorized it in the portal (with a most-per-
 * charge limit) is charged what they owe after insurance: first a notice with
 * the amount and the date, then, three days later, the charge, for no more
 * than the balance still owed and never more than the limit. Patients on a
 * payment plan pay through the plan instead. Idempotency keys stop a double
 * charge when the job runs twice.
 */
import { and, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { stripeClient, type Stripe } from "@/lib/stripe";
import { patientBalanceCents } from "./billing";
import { messagePatient } from "./messaging";
import { practiceConfig } from "./integrations";
import { onInjuryHold } from "./injury-cases";

const { savedCards, cardChargeNotices, paymentPlans, onlinePayments, ledgerEntries, patients, practices, auditLog } = schema;

export const NOTICE_DAYS = 3;
const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function cardOnFileCharges(db: Db, practiceId: string, now = new Date(), client?: Pick<Stripe, "chargeSaved">) {
  const today = now.toISOString().slice(0, 10);
  const cards = await db.select().from(savedCards).where(and(eq(savedCards.practiceId, practiceId), isNull(savedCards.removedAt), isNotNull(savedCards.balanceMaxCents)));
  if (!cards.length) return { noticed: 0, charged: 0, failed: 0, skipped: 0 };
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  let noticed = 0;
  let charged = 0;
  let failed = 0;
  let skipped = 0;
  let stripe: Pick<Stripe, "chargeSaved"> | null = client ?? null;

  for (const card of cards) {
    if (await onInjuryHold(db, card.patientId)) { skipped++; continue; }
    const [plan] = await db.select({ id: paymentPlans.id }).from(paymentPlans).where(and(eq(paymentPlans.patientId, card.patientId), inArray(paymentPlans.status, ["active", "defaulted"]))).limit(1);
    const [pending] = await db.select().from(cardChargeNotices).where(and(eq(cardChargeNotices.cardId, card.id), eq(cardChargeNotices.status, "pending"))).limit(1);
    const balance = await patientBalanceCents(db, card.patientId);

    if (!pending) {
      if (plan || balance < 100) continue;
      const amount = Math.min(balance, card.balanceMaxCents!);
      const chargeOn = addDays(today, NOTICE_DAYS);
      await db.insert(cardChargeNotices).values({ practiceId, patientId: card.patientId, cardId: card.id, amountCents: amount, noticeOn: today, chargeOn });
      const [patient] = await db.select().from(patients).where(eq(patients.id, card.patientId)).limit(1);
      await messagePatient(db, patient, {
        kind: "card_charge_notice", entityId: card.patientId,
        sms: `${practice.name}: your insurance has paid and you owe ${usd(balance)}. On ${chargeOn} we will charge ${usd(amount)} to your ${card.brand ?? "card"} ending ${card.last4 ?? ""}, as you authorized. Call ${practice.phone ?? "the office"} with questions.`,
        email: { subject: `A charge to your card on file with ${practice.name}`, text: `Hi ${patient.firstName},\n\nYour insurance has processed your visit and you owe ${usd(balance)}. As you authorized, on ${chargeOn} we will charge ${usd(amount)} to your ${card.brand ?? "card"} ending ${card.last4 ?? ""}.\n\nIf something looks wrong, or you want to stop charges to this card, call ${practice.phone ?? "the office"} before then.\n\n${practice.name}` },
      });
      noticed++;
      continue;
    }

    if (pending.chargeOn > today) continue;
    const amount = Math.min(pending.amountCents, balance, card.balanceMaxCents!);
    if (plan || amount < 100) {
      await db.update(cardChargeNotices).set({ status: "skipped", detail: plan ? "On a payment plan" : "Nothing owed any more" }).where(eq(cardChargeNotices.id, pending.id));
      skipped++;
      continue;
    }
    stripe = stripe ?? stripeClient((await practiceConfig(db, practiceId)).stripe);
    const [pay] = await db.insert(onlinePayments).values({ practiceId, patientId: card.patientId, amountCents: amount, source: "card_on_file" }).returning();
    try {
      const pi = await stripe.chargeSaved({
        customer: card.providerCustomer, paymentMethod: card.providerMethod, amountCents: amount, description: "Balance after insurance (card on file)",
        metadata: { payment_id: pay.id }, idempotencyKey: `cof-${pending.id}`,
      });
      if (pi.status === "succeeded") {
        const [entry] = await db.insert(ledgerEntries).values({ practiceId, patientId: card.patientId, type: "patient_payment", amountCents: amount, note: `Card on file ${card.brand ?? ""} ${card.last4 ?? ""}`.trim() }).returning();
        await db.update(onlinePayments).set({ providerRef: pi.id, status: "paid", paidAt: new Date(), ledgerEntryId: entry.id }).where(eq(onlinePayments.id, pay.id));
        await db.update(cardChargeNotices).set({ status: "charged", onlinePaymentId: pay.id }).where(eq(cardChargeNotices.id, pending.id));
        await db.insert(auditLog).values({ practiceId, userId: null, action: "card_on_file_charged", entity: "patient", entityId: card.patientId, details: { amountCents: amount } });
        charged++;
      } else {
        const why = pi.last_payment_error?.message ?? pi.status;
        await db.update(onlinePayments).set({ providerRef: pi.id, status: "failed", failure: why }).where(eq(onlinePayments.id, pay.id));
        await db.update(cardChargeNotices).set({ status: "failed", detail: why, onlinePaymentId: pay.id }).where(eq(cardChargeNotices.id, pending.id));
        failed++;
      }
    } catch (e) {
      const why = e instanceof Error ? e.message.slice(0, 300) : "error";
      await db.update(onlinePayments).set({ status: "failed", failure: why }).where(eq(onlinePayments.id, pay.id));
      await db.update(cardChargeNotices).set({ status: "failed", detail: why, onlinePaymentId: pay.id }).where(eq(cardChargeNotices.id, pending.id));
      failed++;
    }
  }
  return { noticed, charged, failed, skipped };
}

/** Stops future charges to a patient's card on file (the card stays for plan autopay, if any). */
export async function revokeCardOnFile(db: Db, practiceId: string, patientId: string, userId?: string) {
  const rows = await db.update(savedCards).set({ balanceMaxCents: null }).where(and(eq(savedCards.practiceId, practiceId), eq(savedCards.patientId, patientId), isNull(savedCards.removedAt))).returning();
  await db.update(cardChargeNotices).set({ status: "skipped", detail: "Authorization withdrawn" }).where(and(eq(cardChargeNotices.patientId, patientId), eq(cardChargeNotices.status, "pending")));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "card_on_file_revoked", entity: "patient", entityId: patientId, details: {} });
  return rows.length;
}

export async function cardOnFileFor(db: Db, patientId: string) {
  const [card] = await db.select().from(savedCards).where(and(eq(savedCards.patientId, patientId), isNull(savedCards.removedAt), isNotNull(savedCards.balanceMaxCents))).limit(1);
  if (!card) return null;
  const notices = await db.select().from(cardChargeNotices).where(and(eq(cardChargeNotices.cardId, card.id), lte(cardChargeNotices.noticeOn, new Date().toISOString().slice(0, 10)))).orderBy(cardChargeNotices.noticeOn);
  return { card, notices: notices.slice(-5) };
}
