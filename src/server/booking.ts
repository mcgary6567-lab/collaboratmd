/**
 * Online booking. The practice sets each provider's weekly hours (in its own
 * time zone); patients pick an open slot on a public page and send a request.
 * A request holds its slot but writes nothing to patient records: staff
 * confirm it (matching or creating the patient, then booking the appointment)
 * or decline it. That keeps a public form from creating or changing charts.
 */
import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { notify } from "./notifications";
import { messagePatient } from "./messaging";

const { bookingSettings, providerHours, bookingRequests, appointments, providers, patients, locations, practices, auditLog } = schema;
const MIN = 60_000;
const DAY = 86_400_000;

export const US_TIME_ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu", "America/Puerto_Rico"];

/* ------------------------------ Time zones ------------------------------ */

function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}

/** The instant when the clock in `tz` reads the given local date and minute of day (handles daylight saving). */
export function zonedToUtc(y: number, m: number, d: number, minuteOfDay: number, tz: string): Date {
  const want = Date.UTC(y, m - 1, d, Math.floor(minuteOfDay / 60), minuteOfDay % 60);
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(t), tz);
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
    t += want - shown;
  }
  return new Date(t);
}

export function localDateLabel(date: Date, tz: string) {
  return date.toLocaleString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" });
}
export function localTimeLabel(date: Date, tz: string) {
  return date.toLocaleString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

/* ------------------------------ Settings ------------------------------ */

export async function getBookingSettings(db: Db, practiceId: string) {
  const [row] = await db.select().from(bookingSettings).where(eq(bookingSettings.practiceId, practiceId)).limit(1);
  return row ?? { practiceId, enabled: false, timeZone: "America/New_York", slotMinutes: 30, minNoticeHours: 24, horizonDays: 21, intro: null, updatedAt: new Date(0) };
}

export async function saveBookingSettings(db: Db, practiceId: string, input: { enabled: boolean; timeZone: string; slotMinutes: number; minNoticeHours: number; horizonDays: number; intro?: string | null }, userId?: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone });
  } catch {
    throw new Error("Choose a valid time zone");
  }
  if (![10, 15, 20, 30, 40, 45, 60, 90].includes(input.slotMinutes)) throw new Error("Choose an appointment length");
  if (!(input.minNoticeHours >= 0 && input.minNoticeHours <= 168)) throw new Error("Notice is 0 to 168 hours");
  if (!(input.horizonDays >= 1 && input.horizonDays <= 90)) throw new Error("Show 1 to 90 days ahead");
  const v = { enabled: input.enabled, timeZone: input.timeZone, slotMinutes: input.slotMinutes, minNoticeHours: Math.round(input.minNoticeHours), horizonDays: Math.round(input.horizonDays), intro: input.intro?.trim().slice(0, 500) || null, updatedAt: new Date() };
  await db.insert(bookingSettings).values({ practiceId, ...v }).onConflictDoUpdate({ target: bookingSettings.practiceId, set: v });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "booking_settings_saved", entity: "practice", entityId: practiceId, details: { enabled: v.enabled } });
}

const toMinute = (hhmm: string) => {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error(`"${hhmm}" is not a time like 09:00`);
  return +m[1] * 60 + +m[2];
};

/** Replaces a provider's weekly hours. Each row is a weekday (0 Sunday) with start and end times like "09:00". */
export async function saveProviderHours(db: Db, practiceId: string, providerId: string, rows: { weekday: number; start: string; end: string; locationId?: string | null }[]) {
  const [prov] = await db.select().from(providers).where(and(eq(providers.id, providerId), eq(providers.practiceId, practiceId))).limit(1);
  if (!prov) throw new Error("Provider not found");
  const clean = rows.filter((r) => r.start && r.end).map((r) => {
    const startMinute = toMinute(r.start);
    const endMinute = toMinute(r.end);
    if (!(r.weekday >= 0 && r.weekday <= 6)) throw new Error("Unknown weekday");
    if (endMinute <= startMinute) throw new Error("Each day's end time must be after its start time");
    return { practiceId, providerId, weekday: r.weekday, startMinute, endMinute, locationId: r.locationId || null };
  });
  const locIds = [...new Set(clean.map((c) => c.locationId).filter((x): x is string => !!x))];
  if (locIds.length) {
    const owned = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.practiceId, practiceId), inArray(locations.id, locIds)));
    if (owned.length !== locIds.length) throw new Error("Location not found");
  }
  await db.delete(providerHours).where(and(eq(providerHours.providerId, providerId), eq(providerHours.practiceId, practiceId)));
  if (clean.length) await db.insert(providerHours).values(clean);
}

export async function hoursFor(db: Db, practiceId: string) {
  return db.select().from(providerHours).where(eq(providerHours.practiceId, practiceId)).orderBy(asc(providerHours.weekday), asc(providerHours.startMinute));
}

/* ------------------------------ Availability ------------------------------ */

export type Slot = { providerId: string; locationId: string | null; startsAt: Date; endsAt: Date };

/** Open slots: inside a provider's hours, far enough ahead, not overlapping an appointment or another pending request. */
export async function availableSlots(db: Db, practiceId: string, opts: { providerId?: string; now?: Date } = {}): Promise<Slot[]> {
  const s = await getBookingSettings(db, practiceId);
  if (!s.enabled) return [];
  const now = opts.now ?? new Date();
  const earliest = new Date(now.getTime() + s.minNoticeHours * 3_600_000);
  const until = new Date(now.getTime() + (s.horizonDays + 1) * DAY);
  const hours = (await hoursFor(db, practiceId)).filter((h) => !opts.providerId || h.providerId === opts.providerId);
  if (!hours.length) return [];
  const active = new Set((await db.select({ id: providers.id }).from(providers).where(and(eq(providers.practiceId, practiceId), eq(providers.active, true)))).map((p) => p.id));
  const providerIds = [...new Set(hours.map((h) => h.providerId))].filter((id) => active.has(id));
  if (!providerIds.length) return [];
  const busy = [
    ...(await db.select({ p: appointments.providerId, a: appointments.startsAt, b: appointments.endsAt }).from(appointments)
      .where(and(eq(appointments.practiceId, practiceId), inArray(appointments.providerId, providerIds), lt(appointments.startsAt, until), gte(appointments.endsAt, now), sql`${appointments.status} NOT IN ('cancelled', 'no_show')`))),
    ...(await db.select({ p: bookingRequests.providerId, a: bookingRequests.startsAt, b: bookingRequests.endsAt }).from(bookingRequests)
      .where(and(eq(bookingRequests.practiceId, practiceId), eq(bookingRequests.status, "pending"), inArray(bookingRequests.providerId, providerIds), lt(bookingRequests.startsAt, until)))),
  ];
  const out: Slot[] = [];
  const today = parts(now, s.timeZone);
  for (let i = 0; i <= s.horizonDays; i++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + i, 12));
    const [y, m, d] = [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()];
    const weekday = day.getUTCDay();
    for (const h of hours.filter((x) => x.weekday === weekday && providerIds.includes(x.providerId))) {
      for (let min = h.startMinute; min + s.slotMinutes <= h.endMinute; min += s.slotMinutes) {
        const startsAt = zonedToUtc(y, m, d, min, s.timeZone);
        const endsAt = new Date(startsAt.getTime() + s.slotMinutes * MIN);
        if (startsAt < earliest || startsAt >= until) continue;
        if (busy.some((b) => b.p === h.providerId && b.a < endsAt && b.b > startsAt)) continue;
        out.push({ providerId: h.providerId, locationId: h.locationId, startsAt, endsAt });
      }
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/* ------------------------------ Requests ------------------------------ */

export type BookingInput = { providerId: string; startsAt: string; firstName: string; lastName: string; dob: string; phone?: string; email?: string; reason?: string; payerName?: string; memberId?: string; smsConsent?: boolean };

export async function requestBooking(db: Db, practiceId: string, input: BookingInput, opts: { now?: Date; ipHash?: string | null } = {}) {
  const now = opts.now ?? new Date();
  const first = input.firstName.trim().slice(0, 60);
  const last = input.lastName.trim().slice(0, 60);
  const phone = (input.phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const email = (input.email ?? "").trim().toLowerCase();
  if (!first || !last) throw new Error("Enter your first and last name");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dob) || new Date(`${input.dob}T12:00:00Z`) > now || input.dob < "1900-01-01") throw new Error("Enter your date of birth");
  if (phone && phone.length !== 10) throw new Error("Enter a 10-digit phone number");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email");
  if (!phone && !email) throw new Error("Give a phone number or email so the office can confirm");
  const slot = (await availableSlots(db, practiceId, { providerId: input.providerId, now })).find((x) => x.startsAt.toISOString() === new Date(input.startsAt).toISOString());
  if (!slot) throw new Error("That time is no longer available. Please pick another.");
  // A few requests per person per day is plenty; more is a form being abused.
  const contact = phone ? sql`${bookingRequests.phone} = ${phone}` : sql`${bookingRequests.email} = ${email}`;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(bookingRequests).where(and(eq(bookingRequests.practiceId, practiceId), gte(bookingRequests.createdAt, new Date(now.getTime() - DAY)), contact));
  if (Number(n) >= 3) throw new Error("You already have requests waiting. The office will contact you.");
  const [row] = await db.insert(bookingRequests).values({
    practiceId, providerId: slot.providerId, locationId: slot.locationId, startsAt: slot.startsAt, endsAt: slot.endsAt,
    firstName: first, lastName: last, dob: input.dob, phone: phone || null, email: email || null,
    reason: input.reason?.trim().slice(0, 300) || null, payerName: input.payerName?.trim().slice(0, 100) || null, memberId: input.memberId?.trim().slice(0, 40) || null,
    smsConsent: !!input.smsConsent && !!phone, ipHash: opts.ipHash ?? null, createdAt: now,
  }).returning();
  // No patient details in the notification: titles go out in the email digest.
  await notify(db, practiceId, { kind: "booking_request", title: "New online appointment request", body: "Confirm or decline it on the schedule.", href: "/scheduling", dedupeKey: `booking:${row.id}` });
  return row;
}

export async function pendingRequests(db: Db, practiceId: string) {
  return db.select({ request: bookingRequests, providerFirst: providers.firstName, providerLast: providers.lastName }).from(bookingRequests)
    .innerJoin(providers, eq(providers.id, bookingRequests.providerId))
    .where(and(eq(bookingRequests.practiceId, practiceId), eq(bookingRequests.status, "pending"))).orderBy(asc(bookingRequests.startsAt));
}

/** Books it: an existing patient with the same name and date of birth, or a new one; then the appointment. */
export async function confirmRequest(db: Db, practiceId: string, id: string, userId: string, deps: Parameters<typeof messagePatient>[3] = {}) {
  const [r] = await db.select().from(bookingRequests).where(and(eq(bookingRequests.id, id), eq(bookingRequests.practiceId, practiceId))).limit(1);
  if (!r || r.status !== "pending") throw new Error("This request was already handled");
  const clash = await db.select({ id: appointments.id }).from(appointments)
    .where(and(eq(appointments.providerId, r.providerId), lt(appointments.startsAt, r.endsAt), sql`${appointments.endsAt} > ${r.startsAt}`, sql`${appointments.status} NOT IN ('cancelled', 'no_show')`)).limit(1);
  if (clash.length) throw new Error("Something else was booked at that time; decline this request and offer another time");
  let [patient] = await db.select().from(patients)
    .where(and(eq(patients.practiceId, practiceId), sql`lower(${patients.lastName}) = ${r.lastName.toLowerCase()}`, sql`lower(${patients.firstName}) = ${r.firstName.toLowerCase()}`, eq(patients.dob, r.dob))).limit(1);
  const matched = !!patient;
  if (!patient) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(patients).where(eq(patients.practiceId, practiceId));
    [patient] = await db.insert(patients).values({
      practiceId, mrn: "P" + String(Number(n) + 1001).padStart(5, "0"), firstName: r.firstName, lastName: r.lastName, dob: r.dob, sex: "U",
      phone: r.phone, email: r.email, smsConsentAt: r.smsConsent ? r.createdAt : null,
    }).returning();
  }
  const [appt] = await db.insert(appointments).values({
    practiceId, patientId: patient.id, providerId: r.providerId, locationId: r.locationId, startsAt: r.startsAt, endsAt: r.endsAt,
    type: "office_visit", reason: [r.reason, r.payerName ? `Insurance given online: ${r.payerName}${r.memberId ? ` ${r.memberId}` : ""}` : null].filter(Boolean).join(" · ") || null,
  }).returning();
  await db.update(bookingRequests).set({ status: "confirmed", appointmentId: appt.id, decidedAt: new Date(), decidedBy: userId }).where(eq(bookingRequests.id, id));
  await db.insert(auditLog).values({ practiceId, userId, action: "booking_confirmed", entity: "appointment", entityId: appt.id, details: { matched } });
  const s = await getBookingSettings(db, practiceId);
  const [practice] = await db.select({ name: practices.name, phone: practices.phone }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  const when = `${localDateLabel(r.startsAt, s.timeZone)} at ${localTimeLabel(r.startsAt, s.timeZone)}`;
  const message = await messagePatient(db, patient, {
    kind: "booking_confirmed", entityId: appt.id,
    sms: `${practice.name}: your appointment is confirmed for ${when}. Call ${practice.phone ?? "us"} to change it. Reply STOP to opt out.`,
    email: { subject: `Your appointment with ${practice.name}`, text: `Your appointment is confirmed for ${when}.\n\nTo change or cancel it, call ${practice.phone ?? "the office"}.\n\n${practice.name}` },
  }, deps).catch(() => null);
  return { appointmentId: appt.id, patientId: patient.id, matched, message, startsAt: r.startsAt };
}

export async function declineRequest(db: Db, practiceId: string, id: string, userId: string) {
  const r = await db.update(bookingRequests).set({ status: "declined", decidedAt: new Date(), decidedBy: userId })
    .where(and(eq(bookingRequests.id, id), eq(bookingRequests.practiceId, practiceId), eq(bookingRequests.status, "pending"))).returning();
  if (!r.length) throw new Error("This request was already handled");
  await db.insert(auditLog).values({ practiceId, userId, action: "booking_declined", entity: "practice", entityId: practiceId });
}
