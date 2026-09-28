/**
 * The waitlist: patients who want an earlier appointment, at the hours they
 * can come. When a time opens (a patient replies X to their reminder, or staff
 * cancel and press "Offer to waitlist"), it is texted to the first few people
 * on the list who can take it; the first to reply B is booked into it and
 * told, and the others are told it has gone if they reply later. If nobody
 * takes it within ROUND_MINUTES, the next few are texted (advanceOffers, run
 * every few minutes). The front desk gets a notification when it is filled.
 *
 * Texts only: an offer has to be answered in minutes, and only a text reply
 * can claim it. Patients without texting consent stay on the list for staff
 * to call.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { messagePatient } from "./messaging";
import { notify } from "./notifications";
import { practiceNow } from "./practice-time";
import { langOf, replyBooked, replyTaken, visitTime, waitlistOffer } from "@/lib/i18n/messages";

const { waitlistEntries, slotOffers, slotOfferRecipients, appointments, patients, providers, practices, auditLog } = schema;

/** How many people one round texts: enough that someone answers, few enough that most replies are not "sorry, taken". */
export const OFFER_TO = 5;
/** An opening sooner than this (on the practice's clock) is not offered: nobody could get there. */
export const MIN_NOTICE_HOURS = 2;
/** With no B after this long, the next people on the list are texted; at most MAX_ROUNDS rounds in all. */
export const ROUND_MINUTES = 30;
export const MAX_ROUNDS = 4;

type Send = (to: string, body: string) => Promise<{ ok: boolean; detail: string }>;

/** The clock hours a patient can come: [from, until), whole hours 0 to 24, or null for any. */
export function checkWindow(from?: number | null, until?: number | null) {
  const ok = (h: number | null | undefined) => h === null || h === undefined || (Number.isInteger(h) && h >= 0 && h <= 24);
  if (!ok(from) || !ok(until)) throw new Error("Hours are 0 to 24");
  if (from != null && until != null && from >= until) throw new Error("The earliest hour must be before the latest");
  return { fromHour: from ?? null, untilHour: until ?? null };
}

/** "9 am to noon" and the like, for the schedule and the patient's page. */
export function windowLabel(from: number | null, until: number | null) {
  const h = (x: number) => (x === 0 || x === 24 ? "midnight" : x === 12 ? "noon" : x < 12 ? `${x} am` : `${x - 12} pm`);
  if (from == null && until == null) return "any time";
  if (from == null) return `before ${h(until!)}`;
  if (until == null) return `after ${h(from)}`;
  return `${h(from)} to ${h(until)}`;
}

export async function addToWaitlist(
  db: Db,
  practiceId: string,
  patientId: string,
  opts: { providerId?: string | null; note?: string | null; fromHour?: number | null; untilHour?: number | null },
  userId?: string,
) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  if (opts.providerId) {
    const [pr] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.id, opts.providerId), eq(providers.practiceId, practiceId))).limit(1);
    if (!pr) throw new Error("Provider not found");
  }
  const window = checkWindow(opts.fromHour, opts.untilHour);
  const [open] = await db.select({ id: waitlistEntries.id }).from(waitlistEntries).where(and(eq(waitlistEntries.practiceId, practiceId), eq(waitlistEntries.patientId, patientId), isNull(waitlistEntries.closedAt))).limit(1);
  if (open) throw new Error("This patient is already on the waitlist");
  const [e] = await db.insert(waitlistEntries).values({ practiceId, patientId, providerId: opts.providerId || null, note: opts.note?.trim().slice(0, 300) || null, ...window, createdBy: userId ?? null }).returning();
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

type Opening = { providerId: string; startsAt: Date; endsAt: Date };

/**
 * People on the list who can take this opening, oldest first: waiting for this
 * provider or any, whose hours include it, textable, not already booked then,
 * and not among `exclude` (the patient who cancelled, earlier rounds).
 */
export async function waitlistCandidates(db: Db, practiceId: string, o: Opening, exclude: string[], limit: number) {
  // Clock times: the hour on the practice's clock is the UTC hour of the stored time.
  const startMin = o.startsAt.getUTCHours() * 60 + o.startsAt.getUTCMinutes();
  const endMin = startMin + Math.round((o.endsAt.getTime() - o.startsAt.getTime()) / 60_000);
  const waiting = await db
    .select({ entry: waitlistEntries, patient: patients })
    .from(waitlistEntries)
    .innerJoin(patients, eq(patients.id, waitlistEntries.patientId))
    .where(and(
      eq(waitlistEntries.practiceId, practiceId), isNull(waitlistEntries.closedAt),
      or(isNull(waitlistEntries.providerId), eq(waitlistEntries.providerId, o.providerId)),
      or(isNull(waitlistEntries.fromHour), sql`${waitlistEntries.fromHour} * 60 <= ${startMin}`),
      or(isNull(waitlistEntries.untilHour), sql`${waitlistEntries.untilHour} * 60 >= ${endMin}`),
      isNotNull(patients.smsConsentAt), isNotNull(patients.phone),
      ...(exclude.length ? [notInArray(waitlistEntries.patientId, exclude)] : []),
    ))
    .orderBy(asc(waitlistEntries.createdAt))
    .limit(limit * 4);
  if (!waiting.length) return [];
  const busy = new Set((await db.select({ patientId: appointments.patientId }).from(appointments).where(and(
    eq(appointments.practiceId, practiceId), inArray(appointments.patientId, waiting.map((w) => w.patient.id)),
    inArray(appointments.status, ["scheduled", "checked_in"]), lt(appointments.startsAt, o.endsAt), gt(appointments.endsAt, o.startsAt),
  ))).map((r) => r.patientId));
  return waiting.filter((w) => !busy.has(w.patient.id));
}

/** Texts one round of an offer; returns how many texts went out. */
async function sendRound(db: Db, practiceId: string, offer: typeof slotOffers.$inferSelect, candidates: Awaited<ReturnType<typeof waitlistCandidates>>, send?: Send) {
  const [[practice], [provider]] = await Promise.all([
    db.select({ name: practices.name, phone: practices.phone }).from(practices).where(eq(practices.id, practiceId)).limit(1),
    db.select({ lastName: providers.lastName }).from(providers).where(eq(providers.id, offer.providerId)).limit(1),
  ]);
  let sent = 0;
  for (const { entry, patient } of candidates) {
    if (sent >= OFFER_TO) break;
    const lang = langOf(patient.preferredLanguage);
    const r = await messagePatient(db, patient, { kind: "waitlist_offer", entityId: offer.id, sms: waitlistOffer(lang, practice, visitTime(lang, offer.startsAt), `Dr. ${provider?.lastName ?? ""}`.trim()) }, send ? { sms: send } : {});
    if (r.sms !== "sent") continue;
    await db.insert(slotOfferRecipients).values({ offerId: offer.id, patientId: patient.id, waitlistEntryId: entry.id }).onConflictDoNothing();
    sent++;
  }
  return sent;
}

export type OfferResult =
  | { status: "offered"; offerId: string; sent: number }
  | { status: "already_offered" | "too_soon" | "no_one" | "not_sent" | "not_cancelled" };

/**
 * Offers a cancelled appointment's time to the waitlist, by text. Once per
 * cancelled appointment; later rounds go out from advanceOffers. `send`
 * replaces the texting service in tests.
 */
export async function offerSlot(db: Db, practiceId: string, appointmentId: string, opts: { userId?: string; now?: Date; send?: Send } = {}): Promise<OfferResult> {
  const now = opts.now ?? new Date();
  const [appt] = await db.select().from(appointments).where(and(eq(appointments.id, appointmentId), eq(appointments.practiceId, practiceId))).limit(1);
  if (!appt || appt.status !== "cancelled") return { status: "not_cancelled" };
  const clock = await practiceNow(db, practiceId, now);
  if (appt.startsAt.getTime() - clock.getTime() < MIN_NOTICE_HOURS * 3_600_000) return { status: "too_soon" };
  const [existing] = await db.select({ id: slotOffers.id }).from(slotOffers).where(eq(slotOffers.cancelledAppointmentId, appt.id)).limit(1);
  if (existing) return { status: "already_offered" };
  const candidates = await waitlistCandidates(db, practiceId, appt, [appt.patientId], OFFER_TO);
  if (!candidates.length) return { status: "no_one" };

  const [offer] = await db
    .insert(slotOffers)
    .values({ practiceId, cancelledAppointmentId: appt.id, providerId: appt.providerId, locationId: appt.locationId, type: appt.type, startsAt: appt.startsAt, endsAt: appt.endsAt, createdBy: opts.userId ?? null, lastRoundAt: now })
    .onConflictDoNothing()
    .returning();
  if (!offer) return { status: "already_offered" };
  const sent = await sendRound(db, practiceId, offer, candidates, opts.send);
  if (!sent) {
    // Nobody could be texted (texting not connected, or opted out): leave it to be offered again.
    await db.delete(slotOffers).where(eq(slotOffers.id, offer.id));
    return { status: "not_sent" };
  }
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "slot_offered", entity: "appointment", entityId: appt.id, details: { offer: offer.id, sent } });
  return { status: "offered", offerId: offer.id, sent };
}

/**
 * The next round for each open offer nobody has taken within ROUND_MINUTES:
 * the next people on the list who can take it. Run every few minutes
 * (server/tick.ts). An offer stops after MAX_ROUNDS, when nobody is left, or
 * when the time is too close.
 */
export async function advanceOffers(db: Db, practiceId: string, opts: { now?: Date; send?: Send } = {}) {
  const now = opts.now ?? new Date();
  const clock = await practiceNow(db, practiceId, now);
  const due = await db.select().from(slotOffers).where(and(
    eq(slotOffers.practiceId, practiceId), isNull(slotOffers.filledAt), lt(slotOffers.rounds, MAX_ROUNDS),
    gt(slotOffers.startsAt, new Date(clock.getTime() + MIN_NOTICE_HOURS * 3_600_000)),
    lt(slotOffers.lastRoundAt, new Date(now.getTime() - ROUND_MINUTES * 60_000)),
  ));
  let rounds = 0;
  for (const offer of due) {
    const before = await db.select({ p: slotOfferRecipients.patientId }).from(slotOfferRecipients).where(eq(slotOfferRecipients.offerId, offer.id));
    const [cancelled] = offer.cancelledAppointmentId ? await db.select({ p: appointments.patientId }).from(appointments).where(eq(appointments.id, offer.cancelledAppointmentId)).limit(1) : [];
    const candidates = await waitlistCandidates(db, practiceId, offer, [...before.map((b) => b.p), ...(cancelled ? [cancelled.p] : [])], OFFER_TO);
    const sent = candidates.length ? await sendRound(db, practiceId, offer, candidates, opts.send) : 0;
    // Nobody left to ask: stop here rather than look again every few minutes.
    await db.update(slotOffers).set({ rounds: sent ? offer.rounds + 1 : MAX_ROUNDS, lastRoundAt: now }).where(eq(slotOffers.id, offer.id));
    if (sent) {
      rounds++;
      await db.insert(auditLog).values({ practiceId, action: "slot_offered", entity: "appointment", entityId: offer.cancelledAppointmentId, details: { offer: offer.id, sent, round: offer.rounds + 1 } });
    }
  }
  return { due: due.length, rounds };
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

/** Twilio reported an offer's text did not reach the phone (server/sms-delivery.ts). */
export async function markOfferUndelivered(db: Db, offerId: string, patientId: string, at = new Date()) {
  await db.update(slotOfferRecipients).set({ undeliveredAt: at }).where(and(eq(slotOfferRecipients.offerId, offerId), eq(slotOfferRecipients.patientId, patientId)));
}

export type OfferState = { sent: number; undelivered: number; rounds: number; filled: boolean };

/** Offers for these cancelled appointments, for the schedule: how many were texted (and not delivered), rounds, and whether it was filled. */
export async function offersFor(db: Db, appointmentIds: string[]) {
  const out = new Map<string, OfferState>();
  if (!appointmentIds.length) return out;
  const rows = await db
    .select({ offer: slotOffers, recipient: slotOfferRecipients.patientId, undeliveredAt: slotOfferRecipients.undeliveredAt })
    .from(slotOffers)
    .leftJoin(slotOfferRecipients, eq(slotOfferRecipients.offerId, slotOffers.id))
    .where(inArray(slotOffers.cancelledAppointmentId, appointmentIds));
  for (const r of rows) {
    const k = r.offer.cancelledAppointmentId!;
    const cur = out.get(k) ?? { sent: 0, undelivered: 0, rounds: r.offer.rounds, filled: !!r.offer.filledPatientId };
    if (r.recipient) cur.sent++;
    if (r.undeliveredAt) cur.undelivered++;
    out.set(k, cur);
  }
  return out;
}
