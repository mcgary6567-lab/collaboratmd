import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { clockIn, decideTimeOff, requestTimeOff, saveShifts, setHolidayCalendar, setTimeZone, type Shift } from "./shifts";
import { addHoliday } from "./holidays";
import {
  addEntry, approveWeek, correctBreak, correctEntry, decideCorrection, parseLocal, reopenWeek, requestCorrection, submitWeek, toLocalInput, weekOf, weekOpenForClock, weekStartOf,
} from "./timesheets";
import { earned, leaveBalances, leaveCheck, leaveDays, saveLeave } from "./leave";
import { grossPay, nightMinutes, payWorksheet, savePay } from "./pay";
import { coverageGrid, dayPieces } from "./shift-week";
import { clockAlerts } from "./clock-alerts";

const at = (iso: string) => new Date(iso);
const weekdays = (startsAt: string, endsAt: string): Shift[] => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt, endsAt }));

describe("weeks, premiums, leave days and coverage", () => {
  it("finds the Monday of a week and reads times in a person's time zone", () => {
    expect([weekStartOf("2026-10-04"), weekStartOf("2026-09-28")]).toEqual(["2026-09-28", "2026-09-28"]);
    const t = parseLocal("2031-03-03T21:30", "Asia/Manila");
    expect(t.toISOString()).toBe("2031-03-03T13:30:00.000Z");
    expect(toLocalInput(t, "Asia/Manila")).toBe("2031-03-03T21:30");
    expect(() => parseLocal("tomorrow", "Asia/Manila")).toThrow(/date and time/);
  });

  it("counts night minutes across midnight and adds premiums to gross pay", () => {
    expect(nightMinutes(20 * 60, 24 * 60, "22:00", "06:00")).toBe(120);
    expect(nightMinutes(0, 7 * 60, "22:00", "06:00")).toBe(360);
    expect(nightMinutes(9 * 60, 17 * 60, "22:00", "06:00")).toBe(0);
    // 8 hours on a holiday, 4 of them at night: double pay, and the 10% night differential on the holiday rate.
    const pay = { rateCents: 10_000, otMultiplier: 1.5, nightPct: 10, holidayMultiplier: 2 };
    expect(grossPay({ regular: 8, overtime: 0, holidayHours: 8, nightHours: 4, nightHolidayHours: 4 }, pay)).toBe(80_000 + 80_000 + 8_000);
    expect(grossPay({ regular: 8, overtime: 0, holidayHours: 0, nightHours: 0, nightHolidayHours: 0 }, { ...pay, nightPct: null, holidayMultiplier: null })).toBe(80_000);
  });

  it("counts leave in working days and accrues it monthly or up front", () => {
    expect(leaveDays("2031-03-03", "2031-03-09", new Set([1, 2, 3, 4, 5]), [{ date: "2031-03-05", name: "Holiday" }])).toBe(4);
    expect([earned(12, "monthly", 3), earned(15, "upfront", 1)]).toEqual([3, 15]);
  });

  it("puts shifts on the viewer's week and counts who covers each hour", () => {
    const day = [{ startsAt: at("2031-03-03T09:00:00Z"), endsAt: at("2031-03-03T17:00:00Z") }];
    const grid = coverageGrid("2031-03-03", "UTC", [day]);
    expect([grid[0][8], grid[0][9], grid[0][16], grid[0][17], grid[1][9]]).toEqual([0, 1, 1, 0, 0]);
    const night = [{ startsAt: at("2031-03-03T21:00:00Z"), endsAt: at("2031-03-04T06:00:00Z") }];
    expect(dayPieces("2031-03-03", "UTC", night).slice(0, 2)).toEqual([["21:00-24:00"], ["00:00-06:00"]]);
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let rosa: typeof schema.users.$inferSelect;
  let omar: typeof schema.users.$inferSelect;
  beforeAll(async () => {
    t = await testDb();
    [rosa, omar] = await t.db.insert(schema.users).values([
      { practiceId: t.practiceId, email: "rosa.sheets@example.test", passwordHash: "x", name: "Rosa Night", role: "biller" },
      { practiceId: t.practiceId, email: "omar.sheets@example.test", passwordHash: "x", name: "Omar Day", role: "biller" },
    ]).returning();
    await setTimeZone(t.db, t.practiceId, rosa.id, "Asia/Manila");
    await setTimeZone(t.db, t.practiceId, omar.id, "Asia/Karachi");
    await saveShifts(t.db, t.practiceId, rosa.id, weekdays("21:00", "06:00"));
    await saveShifts(t.db, t.practiceId, omar.id, weekdays("09:00", "18:00"));
  });
  afterAll(async () => { await t?.close(); });

  it("corrects time on request or by an administrator, and locks an approved week", async () => {
    const tz = "Asia/Manila";
    const now = at("2031-03-10T00:00:00Z");
    // Monday March 3, 21:00 to 06:00 in Manila.
    const [entry] = await t.db.insert(schema.timeEntries).values({ practiceId: t.practiceId, userId: rosa.id, clockIn: at("2031-03-03T13:00:00Z"), clockOut: at("2031-03-03T22:00:00Z") }).returning();
    const asked = await requestCorrection(t.db, t.practiceId, rosa.id, { entryId: entry.id, clockIn: parseLocal("2031-03-03T21:00", tz), clockOut: parseLocal("2031-03-04T05:30", tz), reason: "Left early, forgot to clock out" }, now);
    await expect(decideCorrection(t.db, t.practiceId, asked.id, rosa.id, true, now)).rejects.toThrow(/Another administrator/);
    await decideCorrection(t.db, t.practiceId, asked.id, t.userId, true, now);
    const [fixed] = await t.db.select().from(schema.timeEntries).where(eq(schema.timeEntries.id, entry.id));
    expect(fixed.clockOut?.toISOString()).toBe("2031-03-03T21:30:00.000Z");
    const [audit] = await t.db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "time_entry_corrected"), eq(schema.auditLog.entityId, rosa.id)));
    expect(audit.details).toMatchObject({ before: { clockOut: "2031-03-03T22:00:00.000Z" }, after: { clockOut: "2031-03-03T21:30:00.000Z" } });

    await expect(addEntry(t.db, t.practiceId, t.userId, rosa.id, { clockIn: at("2031-03-03T20:00:00Z"), clockOut: at("2031-03-03T23:00:00Z") }, "Duplicate", now)).rejects.toThrow(/overlap/);
    await expect(correctEntry(t.db, t.practiceId, rosa.id, entry.id, { clockIn: fixed.clockIn, clockOut: at("2031-03-03T22:00:00Z") }, "Own time", now)).rejects.toThrow(/Another administrator/);
    await correctBreak(t.db, t.practiceId, t.userId, { entryId: entry.id }, { startsAt: at("2031-03-03T17:00:00Z"), endsAt: at("2031-03-03T17:30:00Z") }, "Lunch not recorded");
    expect((await weekOf(t.db, rosa.id, "2031-03-03", now)).hours).toBe(8);

    // Submitted, then corrected: back to the person to submit again.
    expect((await submitWeek(t.db, t.practiceId, rosa.id, "2031-03-03", "", now)).hours).toBe(8);
    await expect(submitWeek(t.db, t.practiceId, rosa.id, "2031-03-03", "", now)).rejects.toThrow(/already submitted/);
    await correctEntry(t.db, t.practiceId, t.userId, entry.id, { clockIn: fixed.clockIn, clockOut: at("2031-03-03T21:00:00Z") }, "Stopped at 05:00", now);
    expect((await weekOf(t.db, rosa.id, "2031-03-03", now)).sheet).toBeNull();

    const sheet = await submitWeek(t.db, t.practiceId, rosa.id, "2031-03-03", "All correct", now);
    expect(sheet.hours).toBe(7.5);
    await expect(approveWeek(t.db, t.practiceId, sheet.id, rosa.id, now)).rejects.toThrow(/Another administrator/);
    await approveWeek(t.db, t.practiceId, sheet.id, t.userId, now);
    await expect(correctEntry(t.db, t.practiceId, t.userId, entry.id, { clockIn: fixed.clockIn, clockOut: at("2031-03-03T21:30:00Z") }, "Again", now)).rejects.toThrow(/approved\. Reopen/);
    await expect(requestCorrection(t.db, t.practiceId, rosa.id, { entryId: entry.id, clockIn: fixed.clockIn, clockOut: at("2031-03-03T21:30:00Z"), reason: "Again" }, now)).rejects.toThrow(/approved/);
    await expect(reopenWeek(t.db, t.practiceId, sheet.id, rosa.id, false, "")).rejects.toThrow();
    await reopenWeek(t.db, t.practiceId, sheet.id, t.userId, true, "Correcting the clock-out");
    await correctEntry(t.db, t.practiceId, t.userId, entry.id, { clockIn: fixed.clockIn, clockOut: at("2031-03-03T21:30:00Z") }, "Again", now);
  });

  it("keeps leave balances in working days and warns before going over", async () => {
    const now = at("2031-03-15T00:00:00Z");
    await saveLeave(t.db, t.practiceId, rosa.id, "vacation", { daysPerYear: 12, accrual: "monthly", carryOver: 2 }, t.userId, now);
    expect((await leaveBalances(t.db, [rosa.id], now)).get(rosa.id)).toEqual([expect.objectContaining({ kind: "vacation", earned: 3, carryOver: 2, used: 0, balance: 5 })]);
    const req = await requestTimeOff(t.db, t.practiceId, rosa.id, { startsOn: "2031-03-17", endsOn: "2031-03-23", kind: "vacation" });
    expect(await leaveCheck(t.db, rosa.id, "vacation", "2031-03-17", "2031-03-23", now, req.id)).toEqual({ days: 5, balance: 5, after: 0 });
    await decideTimeOff(t.db, t.practiceId, req.id, true, t.userId, now);
    expect((await leaveBalances(t.db, [rosa.id], now)).get(rosa.id)?.[0]).toMatchObject({ used: 5, balance: 0 });
    expect((await leaveCheck(t.db, rosa.id, "vacation", "2031-03-24", "2031-03-25", now)).after).toBe(-2);
    expect((await leaveCheck(t.db, rosa.id, "sick", "2031-03-24", "2031-03-25", now)).balance).toBeNull();
  });

  it("adds the night differential and holiday pay, and counts approved weeks", async () => {
    await setHolidayCalendar(t.db, t.practiceId, rosa.id, "PH");
    await addHoliday(t.db, t.practiceId, { calendar: "COMPANY", onDate: "2031-06-04", name: "Company day" }, t.userId);
    await savePay(t.db, t.practiceId, rosa.id, { rateCents: 50_000, currency: "PHP", weeklyOtHours: 40, dailyOtHours: null, multiplier: 1.5, nightPct: 10, holidayMultiplier: 2 }, t.userId);
    // Wednesday June 4 21:00 to Thursday 06:00 in Manila: 3 hours on the holiday (2 at night), 6 the next morning (all night).
    await t.db.insert(schema.timeEntries).values({ practiceId: t.practiceId, userId: rosa.id, clockIn: at("2031-06-04T13:00:00Z"), clockOut: at("2031-06-04T22:00:00Z") });
    const now = at("2031-06-10T00:00:00Z");
    const [r] = (await payWorksheet(t.db, t.practiceId, "2031-06-02", "2031-06-08", now)).filter((x) => x.userId === rosa.id);
    expect(r).toMatchObject({ total: 9, holidayHours: 3, nightHours: 8, nightHolidayHours: 2, weeks: ["2031-06-02"], approvedWeeks: 0 });
    expect(r.grossCents).toBe(9 * 50_000 + 3 * 50_000 + 6 * 50_000 * 0.1 + 2 * 50_000 * 2 * 0.1);
    const sheet = await submitWeek(t.db, t.practiceId, rosa.id, "2031-06-02", "", now);
    await approveWeek(t.db, t.practiceId, sheet.id, t.userId, now);
    expect((await payWorksheet(t.db, t.practiceId, "2031-06-02", "2031-06-08", now)).find((x) => x.userId === rosa.id)?.approvedWeeks).toBe(1);

    // No clocking into an approved week; clocking into a submitted one takes the submission back.
    await expect(weekOpenForClock(t.db, rosa.id, at("2031-06-06T13:00:00Z"))).rejects.toThrow(/already approved/);
    await t.db.insert(schema.timeEntries).values({ practiceId: t.practiceId, userId: rosa.id, clockIn: at("2031-06-09T13:00:00Z"), clockOut: at("2031-06-09T21:00:00Z") });
    await submitWeek(t.db, t.practiceId, rosa.id, "2031-06-09", "", at("2031-06-10T00:00:00Z"));
    expect(await weekOpenForClock(t.db, rosa.id, at("2031-06-10T13:00:00Z"))).toEqual({ withdrawn: true });
    expect((await weekOf(t.db, rosa.id, "2031-06-09", now)).sheet).toBeNull();
  });

  it("reminds a late starter, then their administrators, and someone who forgot to clock out", async () => {
    const mine = async (key: string) => t.db.select().from(schema.notifications).where(like(schema.notifications.dedupeKey, `${key}%`));
    // Monday July 7, 2031: Omar's shift starts at 09:00 in Karachi (04:00 UTC).
    await clockAlerts(t.db, at("2031-07-07T04:10:00Z"));
    expect(await mine(`late:${omar.id}`)).toHaveLength(0);
    await clockAlerts(t.db, at("2031-07-07T04:20:00Z"));
    const late = await mine(`late:${omar.id}`);
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ userId: omar.id, title: expect.stringMatching(/9:00 AM.*not clocked in/) });
    expect(await mine(`late-admin:${omar.id}`)).toHaveLength(0);
    await clockAlerts(t.db, at("2031-07-07T04:35:00Z"));
    expect(await mine(`late-admin:${omar.id}`)).toHaveLength(1);
    expect(await mine(`late:${omar.id}`)).toHaveLength(1); // sent once

    const entry = await clockIn(t.db, t.practiceId, omar.id, at("2031-07-07T04:40:00Z"));
    await clockAlerts(t.db, at("2031-07-07T13:30:00Z")); // 18:30 Karachi: only 30 minutes after the shift
    expect(await mine(`forgot:${entry.id}`)).toHaveLength(0);
    await clockAlerts(t.db, at("2031-07-07T14:05:00Z"));
    expect(await mine(`forgot:${entry.id}`)).toMatchObject([{ userId: omar.id, title: expect.stringMatching(/6:00 PM.*still clocked in/) }]);
  });
});
