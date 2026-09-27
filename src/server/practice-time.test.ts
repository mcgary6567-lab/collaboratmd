import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clockDay, practiceClock, practiceNow, practiceTimeZone } from "./practice-time";
import { listAppointments } from "./encounters";
import { getBookingSettings, saveBookingSettings } from "./booking";

describe("the practice's clock", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("knows which day it is at the practice, not on the server", async () => {
    // 02:00 UTC on Oct 6 is still the evening of Oct 5 in Los Angeles.
    const late = new Date("2026-10-06T02:00:00Z");
    expect(clockDay(practiceClock(late, "America/Los_Angeles")).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(clockDay(practiceClock(late, "UTC")).toISOString()).toBe("2026-10-06T00:00:00.000Z");
    await t.db.update(schema.practices).set({ timeZone: "America/Los_Angeles" }).where(eq(schema.practices.id, t.practiceId));
    expect((await practiceNow(t.db, t.practiceId, late)).toISOString()).toBe("2026-10-05T19:00:00.000Z");
  });

  it("is one setting, shared by the profile and online booking", async () => {
    await saveBookingSettings(t.db, t.practiceId, { enabled: true, timeZone: "America/Chicago", slotMinutes: 30, minNoticeHours: 24, horizonDays: 7 });
    expect(await practiceTimeZone(t.db, t.practiceId)).toBe("America/Chicago");
    expect((await getBookingSettings(t.db, t.practiceId)).timeZone).toBe("America/Chicago");
    await expect(saveBookingSettings(t.db, t.practiceId, { enabled: true, timeZone: "Mars/Olympus", slotMinutes: 30, minNoticeHours: 24, horizonDays: 7 })).rejects.toThrow(/time zone/);
  });

  it("lists a day's appointments by clock time, midnight to midnight", async () => {
    const [appt] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.practiceId, t.practiceId)).limit(1);
    const day = clockDay(appt.startsAt);
    const late = new Date(day.getTime() + 23 * 3_600_000 + 30 * 60_000);
    await t.db.update(schema.appointments).set({ startsAt: late, endsAt: new Date(late.getTime() + 1_800_000) }).where(eq(schema.appointments.id, appt.id));
    expect((await listAppointments(t.db, t.practiceId, new Date(day.getTime() + 12 * 3_600_000))).some((a) => a.appt.id === appt.id)).toBe(true);
    expect((await listAppointments(t.db, t.practiceId, new Date(day.getTime() + 36 * 3_600_000))).some((a) => a.appt.id === appt.id)).toBe(false);
  });
});
