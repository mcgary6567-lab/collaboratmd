/**
 * The waitlist: patients who want an earlier appointment. When a time opens
 * (a patient replies X to their reminder, or staff cancel and press "Offer to
 * waitlist"), it is texted to the first few people on the list who can take
 * it; the first to reply B is booked into it and told, and the others are told
 * it has gone if they reply later. The front desk gets a notification.
 *
 * Texts only: an offer has to be answered in minutes, and only a text reply
 * can claim it. Patients without texting consent stay on the list for staff
 * to call.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { messagePatient } from "./messaging";
import { notify } from "./notifications";
import { practiceNow } from "./practice-time";
import { langOf, replyBooked, replyTaken, visitTime, waitlistOffer } from "@/lib/i18n/messages";

const { waitlistEntries, slotOffers, slotOfferRecipients, appointments, patients, providers, practices, auditLog } = schema;

/** How many people one opening is texted to: enough that someone answers, few enough that most replies are not "sorry, taken". */
export const OFFER_TO = 5;
/** An opening sooner than this (on the practice's clock) is not offered: nobody could get there. */
export const MIN_NOTICE_HOURS = 2;

export async function addToWaitlist(db: Db, practiceId: string, patientId: string, opts: { providerId?: string | null; note?: string | null }, userId?: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  if (opts.providerId) {
    const [pr] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, opts.providerId), eq(providers.practiceId, practiceId))).limit(1);
    if (!pr) throw new Error("Provider not found");
  }
  const [open] = await db.select({ id: waitlistEntries.id }).from(waitlistEntries).where(and(eq(waitlistEntries.practiceId, practiceId), eq(waitlistEntries.patientId, patientId), isNull(waitlistEntries.closedAt))).limit(1);
  if (open) throw new Error("This patient is already on the waitlist");
  const [e] = await db.insert(waitlistEntries).values({ practiceId, patientId, providerId: opts.providerId || null, note: opts.note?.trim().slice(0, 300) || null, createdBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "waitlist_added", entity: "patient", entityId: patientId });
  return e;
}

export async function removeFromWaitlist(db: Db, practiceId: string, entryId: string, userId?: string) {
  const [e] = await db.update(waitlistEntries).set({ closedAt: new Date(), closedReason: "removed" }).where(and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.practiceId, practiceId), isNull(waitlistEntries.closedAt))).returning();
  if (e) await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "waitlist_removed", entity: "patient", entityId: e.patientId });
}

/** Who is waiting, oldest first, and whether each can be texted an offer. */
export async function listWaitlist(db: Db, practiceId: string) {
  const rows = await db
    .select({ entry: waitlistEntries, patient: patients, providerLast: providers.lastName })
    .from(waitlistEntries)
    .innerJoin(patients, eq(patients.id, waitlistEntries.patientId))
    .leftJoin(providers, eq(providers.id, waitlistEntries.providerId))
    .where(and(eq(waitlistEntries.practiceId, practiceId), isNull(waitlistEntries.closedAt)))
    .orderBy(asc(waitlistEntries.createdAt));
  return rows.map((r) => ({ ...r, canText: !!(r.patient.phone && r.patient.smsConsentAt) }));
}

export type OfferResult =
  | { status: "offered"; offerId: string; sent: number }
  | { status: "already_offered" | "too_soon" | "no_one" | "not_sent" | "not_cancelled" };

/**
 * Offers a cancelled appointment's time to the waitlist, by text. Once per
 * cancelled appointment. `send` replaces the texting service in tests.
 */
export async function offerSlot(
  db: Db,
  practiceId: string,
  appointmentId: string,
  opts: { userId?: string; now?: Date; send?: (to: string, body: string) => Promise<{ ok: boolean; detail: string }> } = {},
): Promise<OfferResult> {
  const [appt] = await db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
  if (!appt || appt.status !== "cancelled") return { status: "not_cancelled" };
  const clock = await practiceNow(db, practiceId, opts.now ?? new Date());
  if (appt.startsAt.getTime() - clock.getTime() < MIN_NOTICE_HOURS * 3_600_000) return { status: "too_soon" };
  const [existing] = await db.select({ id: slotOffers.id }).from(slotOffers).where(eq(slotOffers.cancelledAppointmentId, appt.id)).limit(1);
  if (existing) return { status: "already_offered" };

  // Waiting for this provider or any, textable, and not already booked at that time.
  const waiting = await db
    .select({ entry: waitlistEntries, patient: patients })
    .from(waitlistEntries)
    .innerJoin(patients, eq(patients.id, waitlistEntries.patientId))
    .where(and(
      eq(waitlistEntries.practiceId, practiceId), isNull(waitlistEntries.closedAt),
      or(isNull(waitlistEntries.providerId), eq(waitlistEntries.providerId, appt.providerId)),
      ne(waitlistEntries.patientId, appt.patientId), isNotNull(patients.smsConsentAt), isNotNull(patients.phone),
    ))
    .orderBy(asc(waitlistEntries.createdAt))
    .limit(OFFER_TO * 4);
  const busy = waiting.length
    ? new Set((await db.select({ patientId: appointments.patientId }).from(appointments).where(and(
        eq(appointments.practiceId, practiceId), inArray(appointments.patientId, waiting.map((w) => w.patient.id)),
        inArray(appointments.status, ["scheduled", "checked_in"]), lt(appointments.startsAt, appt.endsAt), gt(appointments.endsAt, appt.startsAt),
      ))).map((r) => r.patientId))
    : new Set<string>();
  const candidates = waiting.filter((w) => !busy.has(w.patient.id));
  if (!candidates.length) return { status: "no_one" };

  const [offer] = await db
    .insert(slotOffers)
    .values({ practiceId, cancelledAppointmentId: appt.id, providerId: appt.providerId, locationId: appt.locationId, type: appt.type, startsAt: appt.startsAt, endsAt: appt.endsAt, createdBy: opts.userId ?? null })
    .onConflictDoNothing()
    .returning();
  if (!offer) return { status: "already_offered" };
  const [[practice], [provider]] = await Promise.all([
    db.select({ name: practices.name, phone: practices.phone }).from(practices).where(eq(practices.id, practiceId)).limit(1),
    db.select({ lastName: providers.lastName }).from(providers).where(eq(providers.id, appt.providerId)).limit(1),
  ]);
  let sent = 0;
  for (const { entry, patient } of candidates) {
    if (sent >= OFFER_TO) break;
    const lang = langOf(patient.preferredLanguage);
    const r = await messagePatient(db, patient, { kind: "waitlist_offer", entityId: offer.id, sms: waitlistOffer(lang, practice, visitTime(lang, appt.startsAt), `Dr. ${provider?.lastName ?? ""}`.trim()) }, opts.send ? { sms: opts.send } : {});
    if (r.sms !== "sent") continue;
    await db.insert(slotOfferRecipients).values({ offerId: offer.id, patientId: patient.id, waitlistEntryId: entry.id });
    sent++;
  }
  if (!sent) {
    // Nobody could be texted (texting not connected, or opted out): leave it to be offered again.
    await db.delete(slotOffers).where(eq(slotOffers.id, offer.id));
    return { status: "not_sent" };
  }
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "slot_offered", entity: "appointment", entityId: appt.id, details: { offer: offer.id, sent } });
  return { status: "offered", offerId: offer.id, sent };
}

export type ClaimResult = { status: "booked"; appointmentId: string; text: string } | { status: "taken"; text: string };

/**
 * A patient replied B: books them into the most recent opening they were
 * offered, if nobody got there first. The claim is one conditional update, so
 * two replies at once cannot both win. Returns the text to send back, or null
 * when they have no open offer (the reply then just waits in the inbox).
 */
export async function claimOffer(db: Db, practiceId: string, patientId: string, now = new Date()): Promise<ClaimResult | null> {
  const clock = await practiceNow(db, practiceId, now);
  const [latest] = await db
    .select({ offer: slotOffers, entryId: slotOfferRecipients.waitlistEntryId })
    .from(slotOfferRecipients)
    .innerJoin(slotOffers, eq(slotOffers.id, slotOfferRecipients.offerId))
    .where(and(eq(slotOffers.practiceId, practiceId), eq(slotOfferRecipients.patientId, patientId), gt(slotOffers.startsAt, clock)))
    .orderBy(desc(slotOfferRecipients.sentAt))
    .limit(1);
  if (!latest) return null;
  const [[patient], [practice]] = await Promise.all([
    db.select().from(patients).where(eq(patients.id, patientId)).limit(1),
    db.select({ name: practices.name, phone: practices.phone }).from(practices).where(eq(practices.id, practiceId)).limit(1),
  ]);
  const lang = langOf(patient?.preferredLanguage);
  const o = latest.offer;
  if (o.filledAt) return { status: "taken", text: replyTaken(lang, practice) };

  // Booked by hand in the meantime? Then the offer is over.
  const [clash] = await db.select({ id: appointments.id }).from(appointments).where(and(
    eq(appointments.practiceId, practiceId), eq(appointments.providerId, o.providerId), inArray(appointments.status, ["scheduled", "checked_in"]),
    lt(appointments.startsAt, o.endsAt), gt(appointments.endsAt, o.startsAt),
  )).limit(1);
  if (clash) {
    await db.update(slotOffers).set({ filledAt: now }).where(and(eq(slotOffers.id, o.id), isNull(slotOffers.filledAt)));
    return { status: "taken", text: replyTaken(lang, practice) };
  }
  const [won] = await db.update(slotOffers).set({ filledAt: now, filledPatientId: patientId }).where(and(eq(slotOffers.id, o.id), isNull(slotOffers.filledAt))).returning();
  if (!won) return { status: "taken", text: replyTaken(lang, practice) };

  const [appt] = await db
    .insert(appointments)
    .values({ practiceId, patientId, providerId: o.providerId, locationId: o.locationId, type: o.type, startsAt: o.startsAt, endsAt: o.endsAt, status: "scheduled", reason: "From the waitlist", confirmedAt: now, confirmedVia: "sms" })
    .returning();
  await db.update(slotOffers).set({ filledAppointmentId: appt.id }).where(eq(slotOffers.id, o.id));
  await db.update(waitlistEntries).set({ closedAt: now, closedReason: "booked" }).where(eq(waitlistEntries.id, latest.entryId));
  await db.insert(auditLog).values({ practiceId, action: "waitlist_slot_filled", entity: "appointment", entityId: appt.id, details: { offer: o.id } });
  // No patient details in the notification: titles can reach the email digest.
  await notify(db, practiceId, { kind: "waitlist_filled", title: "A cancelled time was filled from the waitlist", body: "The patient was booked and told by text.", href: `/scheduling?date=${o.startsAt.toISOString().slice(0, 10)}`, dedupeKey: `waitlist-filled:${o.id}` });
  return { status: "booked", appointmentId: appt.id, text: replyBooked(lang, practice, visitTime(lang, o.startsAt)) };
}

/** Offers for these cancelled appointments, for the schedule: how many were texted, and whether it was filled. */
export async function offersFor(db: Db, appointmentIds: string[]) {
  if (!appointmentIds.length) return new Map<string, { sent: number; filled: boolean }>();
  const rows = await db
    .select({ offer: slotOffers, recipient: slotOfferRecipients.patientId })
    .from(slotOffers)
    .leftJoin(slotOfferRecipients, eq(slotOfferRecipients.offerId, slotOffers.id))
    .where(inArray(slotOffers.cancelledAppointmentId, appointmentIds));
  const out = new Map<string, { sent: number; filled: boolean }>();
  for (const r of rows) {
    const k = r.offer.cancelledAppointmentId!;
    const cur = out.get(k) ?? { sent: 0, filled: !!r.offer.filledPatientId };
    if (r.recipient) cur.sent++;
    out.set(k, cur);
  }
  return out;
}
