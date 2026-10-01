/**
 * Expiring cards on file. A saved card that pays a plan automatically, or
 * that the patient authorized for balances after insurance, stops working
 * when it expires, and the practice finds out only when a charge fails.
 * Cards expiring within the window are listed with what they pay for; the
 * patient is sent a portal link where "Replace card" saves a new one without
 * charging it (server/portal.ts startCardUpdate), keeping the autopay plan
 * and the card-on-file authorization.
 */
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { createPortalLink } from "./portal";
import { messagePatient, type MessageResult } from "./messaging";

const { savedCards, patients, practices, messageLog, auditLog } = schema;

/** The last day a card works: the end of its expiry month. */
export function cardExpiresOn(expMonth: number, expYear: number) {
  return new Date(Date.UTC(expYear, expMonth, 0)).toISOString().slice(0, 10);
}

export async function expiringCards(db: Db, practiceId: string, withinDays = 45, now = new Date()) {
  const until = new Date(now.getTime() + withinDays * 86_400_000).toISOString().slice(0, 10);
  const rows = await db.select({ card: savedCards, firstName: patients.firstName, lastName: patients.lastName, mrn: patients.mrn, phone: patients.phone, email: patients.email })
    .from(savedCards).innerJoin(patients, eq(patients.id, savedCards.patientId))
    .where(and(eq(savedCards.practiceId, practiceId), isNull(savedCards.removedAt), isNotNull(savedCards.expMonth), isNotNull(savedCards.expYear),
      or(isNotNull(savedCards.autopayPlanId), isNotNull(savedCards.balanceMaxCents))));
  const out = [];
  for (const r of rows) {
    const expiresOn = cardExpiresOn(r.card.expMonth!, r.card.expYear!);
    if (expiresOn > until) continue;
    const [last] = await db.select({ at: messageLog.createdAt }).from(messageLog)
      .where(and(eq(messageLog.patientId, r.card.patientId), eq(messageLog.kind, "card_expiring"), eq(messageLog.entityId, r.card.id))).orderBy(desc(messageLog.createdAt)).limit(1);
    out.push({ ...r, expiresOn, expired: expiresOn < now.toISOString().slice(0, 10), uses: [r.card.autopayPlanId ? "payment plan autopay" : null, r.card.balanceMaxCents ? "balances after insurance" : null].filter(Boolean) as string[], lastNotified: last?.at ?? null });
  }
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
}

/** Texts or emails the patient a portal link to replace the card. */
export async function sendCardUpdateLink(db: Db, practiceId: string, cardId: string, opts: { origin: string; userId?: string; deps?: Parameters<typeof messagePatient>[3] }): Promise<MessageResult> {
  const [card] = await db.select().from(savedCards).where(and(eq(savedCards.id, cardId), eq(savedCards.practiceId, practiceId), isNull(savedCards.removedAt))).limit(1);
  if (!card) throw new Error("Card not found");
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const link = await createPortalLink(db, practiceId, card.patientId, opts.userId, "portal");
  const url = `${opts.origin}${link.path}`;
  const p = link.patient;
  const exp = card.expMonth && card.expYear ? `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` : "soon";
  const es = p.preferredLanguage === "es";
  const sms = es
    ? `${practice.name}: su tarjeta que termina en ${card.last4 ?? ""} vence ${exp}. Para que sus pagos sigan funcionando, cámbiela aquí (no se cobra nada): ${url}`
    : `${practice.name}: your card ending ${card.last4 ?? ""} on file expires ${exp}. To keep your payments working, replace it here (nothing is charged): ${url}`;
  const r = await messagePatient(db, p, { kind: "card_expiring", entityId: card.id, sms, email: { subject: es ? `Su tarjeta guardada en ${practice.name} vence pronto` : `Your card on file with ${practice.name} expires soon`, text: sms } }, opts.deps);
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "card_expiry_notice", entity: "patient", entityId: card.patientId, details: { cardId, sms: r.sms, email: r.email } });
  return r;
}

/** Sends the link to every patient with an expiring card not notified in the last 14 days. */
export async function notifyExpiringCards(db: Db, practiceId: string, opts: { origin: string; userId?: string; now?: Date; deps?: Parameters<typeof messagePatient>[3] }) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - 14 * 86_400_000);
  let sent = 0, skipped = 0;
  for (const c of await expiringCards(db, practiceId, 45, now)) {
    if (c.lastNotified && c.lastNotified >= since) { skipped++; continue; }
    const r = await sendCardUpdateLink(db, practiceId, c.card.id, opts);
    if (r.sms === "sent" || r.email === "sent") sent++; else skipped++;
  }
  return { sent, skipped };
}
