import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clearConfigCache, saveIntegration } from "./integrations";
import { clockDay, practiceNow } from "./practice-time";
import { addToWaitlist, offerSlot, offersFor, ROUND_MINUTES, windowLabel } from "./waitlist";
import { checkTickStale, runTick } from "./tick";
import { lastBeat } from "./heartbeats";
import { recordDelivery, undeliveredReminders } from "./sms-delivery";
import { confirmRequest, requestWaitlist, saveBookingSettings } from "./booking";

type Sent = { to: string; body: string };

describe("the five-minute run: waitlist rounds, hours, delivery reports, and joining online", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let pats: (typeof schema.patients.$inferSelect)[];
  let providerId: string;
  const sent: Sent[] = [];
  let sid = 0;
  const send = async (to: string, body: string) => {
    sent.push({ to, body });
    return { ok: true, detail: `sid SM${String(++sid).padStart(32, "0")}` };
  };
  const phoneOf = (i: number) => `+1555010${String(3000 + i)}`;

  beforeAll(async () => {
    t = await testDb();
    await saveIntegration(t.db, t.practiceId, "twilio", { enabled: true, settings: { accountSid: "AC" + "a".repeat(32), from: "+15125550100" }, secrets: { authToken: "b".repeat(32) } });
    clearConfigCache();
    pats = (await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId))).slice(0, 12);
    for (const [i, p] of pats.entries()) await t.db.update(schema.patients).set({ phone: phoneOf(i), smsConsentAt: new Date() }).where(eq(schema.patients.id, p.id));
    const [prov] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    providerId = prov.id;
    await t.db.update(schema.appointments).set({ status: "cancelled" }).where(eq(schema.appointments.practiceId, t.practiceId));
  });
  afterAll(async () => { await t?.close(); });

  const tomorrowAt = async (hour: number) => new Date(clockDay(await practiceNow(t.db, t.practiceId)).getTime() + (24 + hour) * 3_600_000);
  const cancelled = async (patientIdx: number, startsAt: Date) => (await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: pats[patientIdx].id, providerId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), type: "office_visit", status: "cancelled" }).returning())[0];

  it("offers a time only to people whose hours include it, and the next people when nobody takes it", async () => {
    expect(windowLabel(null, 12)).toBe("before noon");
    expect(windowLabel(12, null)).toBe("after noon");
    await expect(addToWaitlist(t.db, t.practiceId, pats[1].id, { fromHour: 14, untilHour: 9 })).rejects.toThrow(/before the latest/);
    // 1 to 7: mornings only (1), afternoons only (2), and any time (3 to 7, oldest first).
    await addToWaitlist(t.db, t.practiceId, pats[1].id, { untilHour: 12 });
    await addToWaitlist(t.db, t.practiceId, pats[2].id, { fromHour: 12 });
    for (const i of [3, 4, 5, 6, 7]) await addToWaitlist(t.db, t.practiceId, pats[i].id, {});

    const afternoon = await cancelled(0, await tomorrowAt(15));
    const first = await offerSlot(t.db, t.practiceId, afternoon.id, { send });
    expect(first).toMatchObject({ status: "offered", sent: 5 });
    const round1 = sent.map((m) => m.to);
    expect(round1).toContain(phoneOf(2));
    expect(round1).not.toContain(phoneOf(1));

    // Before ROUND_MINUTES nothing more goes out; after it, the one left who can take it.
    const now = new Date();
    expect(await runTick(t.db, "http://localhost", now, { send })).toEqual({});
    const later = new Date(now.getTime() + (ROUND_MINUTES + 1) * 60_000);
    const r = await runTick(t.db, "http://localhost", later, { send });
    expect(Object.values(r)[0]).toMatchObject({ offers: { due: 1, rounds: 1 } });
    const round2 = sent.slice(round1.length).map((m) => m.to);
    expect(round2).toEqual([phoneOf(7)]);
    expect(await lastBeat(t.db, "tick")).toEqual(later);
    // Nobody else can take it: the offer stops asking.
    const after = new Date(later.getTime() + (ROUND_MINUTES + 1) * 60_000);
    await runTick(t.db, "http://localhost", after, { send });
    expect(sent.length).toBe(round1.length + 1);
    expect((await offersFor(t.db, [afternoon.id])).get(afternoon.id)).toMatchObject({ sent: 6, filled: false });
  });

  it("records texts that did not arrive: the offer counts it, and the schedule shows a missed reminder", async () => {
    const [offerMsg] = await t.db.select().from(schema.messageLog).where(and(eq(schema.messageLog.kind, "waitlist_offer"), eq(schema.messageLog.patientId, pats[3].id))).limit(1);
    const offerSid = offerMsg.detail!.replace(/^sid /, "");
    expect(await recordDelivery(t.db, t.practiceId, { sid: offerSid, status: "sent" })).toEqual({ updated: 0 });
    expect(await recordDelivery(t.db, t.practiceId, { sid: "not-a-sid", status: "undelivered" })).toEqual({ updated: 0 });
    await recordDelivery(t.db, t.practiceId, { sid: offerSid, status: "undelivered", errorCode: "30003" });
    const [appt] = await t.db.select().from(schema.slotOffers).limit(1);
    expect((await offersFor(t.db, [appt.cancelledAppointmentId!])).get(appt.cancelledAppointmentId!)?.undelivered).toBe(1);

    // A reminder that did not arrive, for an upcoming visit.
    const [visit] = await t.db.insert(schema.appointments).values({ practiceId: t.practiceId, patientId: pats[8].id, providerId, startsAt: await tomorrowAt(9), endsAt: await tomorrowAt(9.5), type: "office_visit" }).returning();
    const reminderSid = "SM" + "f".repeat(32);
    await t.db.insert(schema.messageLog).values({ practiceId: t.practiceId, patientId: pats[8].id, channel: "sms", kind: "appointment_reminder", recipient: phoneOf(8), entityId: visit.id, status: "sent", detail: `sid ${reminderSid}` });
    expect((await undeliveredReminders(t.db, t.practiceId, [visit.id])).has(visit.id)).toBe(false);
    await recordDelivery(t.db, t.practiceId, { sid: reminderSid, status: "failed" });
    expect((await undeliveredReminders(t.db, t.practiceId, [visit.id])).has(visit.id)).toBe(true);
    // Delivered reports leave the log alone (it still counts as sent, so reminders are not repeated).
    await recordDelivery(t.db, t.practiceId, { sid: "SM" + "e".repeat(32), status: "delivered" });
  });

  it("sends tomorrow's reminders and the morning-of text at the practice's own hours", async () => {
    await t.db.update(schema.practices).set({ automation: { appointmentReminders: true, sameDayReminders: true }, timeZone: "America/Chicago" }).where(eq(schema.practices.id, t.practiceId));
    // 12:00 UTC on Oct 6 is 7:00 in Chicago: the morning-of text; 15:00 UTC is 10:00, tomorrow's reminders.
    const seven = await runTick(t.db, "http://localhost", new Date("2026-10-06T12:00:00Z"), { send });
    expect(Object.values(seven).some((r) => "sameDay" in r && !("dayBefore" in r))).toBe(true);
    const ten = await runTick(t.db, "http://localhost", new Date("2026-10-06T15:00:00Z"), { send });
    expect(Object.values(ten).some((r) => "dayBefore" in r && !("sameDay" in r))).toBe(true);
    const noon = await runTick(t.db, "http://localhost", new Date("2026-10-06T17:00:00Z"), { send });
    expect(Object.values(noon).some((r) => "dayBefore" in r || "sameDay" in r)).toBe(false);
  });

  it("alerts once the five-minute runs stop", async () => {
    const at = (await lastBeat(t.db, "tick"))!;
    const alerts: string[] = [];
    const alert = async (subject: string) => { alerts.push(subject); return { email: 0, sms: 0, webhook: false }; };
    expect(await checkTickStale(t.db, new Date(at.getTime() + 10 * 60_000), alert as never)).toMatchObject({ stale: false });
    expect(await checkTickStale(t.db, new Date(at.getTime() + 3 * 3_600_000), alert as never)).toMatchObject({ stale: true, minutes: 180 });
    expect(alerts).toEqual(["Outside checks have stopped"]);
  });

  it("puts a patient who asks online on the waitlist once staff confirm, with their hours", async () => {
    await saveBookingSettings(t.db, t.practiceId, { enabled: true, timeZone: "America/New_York", slotMinutes: 30, minNoticeHours: 24, horizonDays: 7 });
    await expect(requestWaitlist(t.db, t.practiceId, { firstName: "Ana", lastName: "Waits", dob: "1980-02-03", email: "ana@example.test" })).rejects.toThrow(/mobile number/);
    const req = await requestWaitlist(t.db, t.practiceId, { firstName: "Ana", lastName: "Waits", dob: "1980-02-03", phone: "555-010-4444", untilHour: 12, smsConsent: true, reason: "Knee" });
    expect(req).toMatchObject({ kind: "waitlist", startsAt: null, untilHour: 12 });
    const r = await confirmRequest(t.db, t.practiceId, req.id, t.userId, { sms: send });
    expect(r).toMatchObject({ waitlist: true, matched: false, appointmentId: null });
    const [entry] = await t.db.select().from(schema.waitlistEntries).where(eq(schema.waitlistEntries.patientId, r.patientId));
    expect(entry).toMatchObject({ untilHour: 12, fromHour: null, closedAt: null });
    const [patient] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, r.patientId));
    expect(patient.smsConsentAt).not.toBeNull();
    expect(sent.at(-1)!.body).toMatch(/you are on our waitlist/);
  });
});
