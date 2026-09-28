import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clockDay, practiceClock, practiceNow, practiceTimeZone } from "./practice-time";
import { listAppointments } from "./encounters";
import { getBookingSettings, saveBookingSettings } from "./booking";
import { createCheckinLink } from "./checkin";

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

  it("keeps a check-in link usable through the practice's evening, not until UTC's", async () => {
    await t.db.update(schema.practices).set({ timeZone: "America/New_York" }).where(eq(schema.practices.id, t.practiceId));
    const [appt] = await t.db.select().from(schema.appointments).where(eq(schema.appointments.practiceId, t.practiceId)).limit(1);
    // Nine hours ago on the practice's clock: within the 12 hours a link lasts. Compared with the real time
    // instead (New York is 4 or 5 hours behind UTC), it would look 13 or 14 hours old, and be refused.
    const nineHoursAgo = new Date((await practiceNow(t.db, t.practiceId)).getTime() - 9 * 3_600_000);
    await t.db.update(schema.appointments).set({ startsAt: nineHoursAgo, endsAt: new Date(nineHoursAgo.getTime() + 1_800_000), status: "scheduled" }).where(eq(schema.appointments.id, appt.id));
    const link = await createCheckinLink(t.db, t.practiceId, appt.id);
    expect(link.path).toMatch(/^\/check-in\//);
    // Yesterday's is gone.
    const yesterday = new Date(nineHoursAgo.getTime() - 86_400_000);
    await t.db.update(schema.appointments).set({ startsAt: yesterday, endsAt: new Date(yesterday.getTime() + 1_800_000) }).where(eq(schema.appointments.id, appt.id));
    await expect(createCheckinLink(t.db, t.practiceId, appt.id)).rejects.toThrow(/already passed/);
  });
});

describe("the demo practice's schedule", () => {
  it("puts today's appointments on the practice's today, also in its evening", async () => {
    // 01:00 UTC on Oct 6 is 21:00 on Oct 5 in New York (the demo practice's time zone).
    // The server runs in UTC (instrumentation.ts), which is where using the server's own date goes wrong.
    const tz = process.env.TZ;
    process.env.TZ = "UTC";
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-06T01:00:00Z") });
    const t = await testDb();
    try {
      const rows = await t.db.select({ startsAt: schema.appointments.startsAt }).from(schema.appointments).where(eq(schema.appointments.practiceId, t.practiceId));
      const days = new Set(rows.map((r) => clockDay(r.startsAt).toISOString().slice(0, 10)));
      expect([...days].sort()).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    } finally {
      vi.useRealTimers();
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
      await t.close();
    }
  });
});
