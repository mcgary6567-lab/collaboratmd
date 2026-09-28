import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { availableSlots, confirmRequest, declineRequest, requestBooking, saveBookingSettings, saveProviderHours, practiceClock } from "./booking";

describe("time zones", () => {
  it("reads the practice's clock now, on both sides of daylight saving", () => {
    expect(practiceClock(new Date("2026-07-15T14:00:00Z"), "America/Chicago").toISOString()).toBe("2026-07-15T09:00:00.000Z");
    expect(practiceClock(new Date("2026-12-15T15:00:00Z"), "America/Chicago").toISOString()).toBe("2026-12-15T09:00:00.000Z");
    expect(practiceClock(new Date("2026-11-02T14:00:00Z"), "America/New_York").toISOString()).toBe("2026-11-02T09:00:00.000Z");
    expect(practiceClock(new Date("2026-07-15T16:00:00Z"), "America/Phoenix").toISOString()).toBe("2026-07-15T09:00:00.000Z");
  });
});

describe("online booking", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let providerId: string;
  // A Monday at 08:00 in Chicago.
  const now = new Date("2026-10-05T13:00:00Z");
  beforeAll(async () => {
    t = await testDb();
    [{ id: providerId }] = await t.db.select({ id: schema.providers.id }).from(schema.providers).where(and(eq(schema.providers.practiceId, t.practiceId), eq(schema.providers.active, true))).limit(1);
  });
  afterAll(async () => { await t?.close(); });

  it("offers nothing until it is switched on and hours are set", async () => {
    expect(await availableSlots(t.db, t.practiceId, { now })).toEqual([]);
    await saveBookingSettings(t.db, t.practiceId, { enabled: true, timeZone: "America/Chicago", slotMinutes: 30, minNoticeHours: 24, horizonDays: 7 });
    expect(await availableSlots(t.db, t.practiceId, { now })).toEqual([]);
    await expect(saveProviderHours(t.db, t.practiceId, providerId, [{ weekday: 2, start: "12:00", end: "09:00" }])).rejects.toThrow(/after its start/);
    // Tuesdays 09:00 to 11:00.
    await saveProviderHours(t.db, t.practiceId, providerId, [{ weekday: 2, start: "09:00", end: "11:00" }]);
    const slots = await availableSlots(t.db, t.practiceId, { providerId, now });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(["2026-10-06T09:00:00.000Z", "2026-10-06T09:30:00.000Z", "2026-10-06T10:00:00.000Z", "2026-10-06T10:30:00.000Z"]);
  });

  it("takes a request for an open slot, holds it, and books it on confirmation", async () => {
    await expect(requestBooking(t.db, t.practiceId, { providerId, startsAt: "2026-10-06T09:00:00.000Z", firstName: "Nia", lastName: "Webb", dob: "1990-05-01" }, { now })).rejects.toThrow(/phone number or email/);
    await expect(requestBooking(t.db, t.practiceId, { providerId, startsAt: "2026-10-06T09:10:00.000Z", firstName: "Nia", lastName: "Webb", dob: "1990-05-01", phone: "555-010-1234" }, { now })).rejects.toThrow(/no longer available/);
    const req = await requestBooking(t.db, t.practiceId, { providerId, startsAt: "2026-10-06T09:00:00.000Z", firstName: "Nia", lastName: "Webb", dob: "1990-05-01", phone: "(555) 010-1234", smsConsent: true, payerName: "Aetna", memberId: "W1" }, { now });
    expect(req).toMatchObject({ status: "pending", phone: "5550101234", smsConsent: true });
    const left = await availableSlots(t.db, t.practiceId, { providerId, now });
    expect(left.map((s) => s.startsAt.toISOString())).not.toContain("2026-10-06T09:00:00.000Z");
    await expect(requestBooking(t.db, t.practiceId, { providerId, startsAt: "2026-10-06T09:00:00.000Z", firstName: "Sam", lastName: "Hill", dob: "1980-01-01", email: "sam@example.test" }, { now })).rejects.toThrow(/no longer available/);

    const before = await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId));
    const sent: string[] = [];
    const r = await confirmRequest(t.db, t.practiceId, req.id, t.userId, { sms: async (to, body) => { sent.push(`${to} ${body}`); return { ok: true, detail: "ok" }; }, email: async () => true });
    expect(r.matched).toBe(false);
    const [appt] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.id, r.appointmentId!));
    // On the schedule at the hour the patient chose (clock time, like every appointment).
    expect(appt.startsAt.toISOString()).toBe("2026-10-06T09:00:00.000Z");
    expect(appt.reason).toContain("Insurance given online: Aetna W1");
    const [p] = await t.db.select().from(schema.patients).where(eq(schema.patients.id, r.patientId));
    expect(p).toMatchObject({ firstName: "Nia", lastName: "Webb", dob: "1990-05-01" });
    expect(p.smsConsentAt).toBeInstanceOf(Date);
    expect((await t.db.select().from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId))).length).toBe(before.length + 1);
    await expect(confirmRequest(t.db, t.practiceId, req.id, t.userId)).rejects.toThrow(/already handled/);

    // The same person booking again is matched to their chart.
    const again = await requestBooking(t.db, t.practiceId, { providerId, startsAt: "2026-10-06T10:00:00.000Z", firstName: "nia", lastName: "WEBB", dob: "1990-05-01", email: "nia@example.test" }, { now });
    expect((await confirmRequest(t.db, t.practiceId, again.id, t.userId)).matched).toBe(true);
    const third = await requestBooking(t.db, t.practiceId, { providerId, startsAt: "2026-10-06T10:30:00.000Z", firstName: "Lee", lastName: "Park", dob: "1975-03-03", email: "lee@example.test" }, { now });
    await declineRequest(t.db, t.practiceId, third.id, t.userId);
    expect((await availableSlots(t.db, t.practiceId, { providerId, now })).map((s) => s.startsAt.toISOString())).toContain("2026-10-06T10:30:00.000Z");
  });
});
