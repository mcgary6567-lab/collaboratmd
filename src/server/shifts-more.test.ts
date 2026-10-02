import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { applyRules, saveRule } from "./work-rules";
import {
  availability, clockIn, clockOut, decideTimeOff, endBreak, hoursAndOutput, isWorking, removeTimeOff, requestTimeOff, saveClockNetworks, saveShifts,
  setHolidayCalendar, setTimeZone, startBreak, workingDueDate, type Shift,
} from "./shifts";
import { builtInHolidays, easter, addHoliday } from "./holidays";
import { decideSwap, offerableShifts, requestSwap, respondSwap } from "./shift-swaps";
import { payWorksheet, savePay, splitOvertime } from "./pay";

const at = (iso: string) => new Date(iso);
const weekdays = (startsAt: string, endsAt: string): Shift[] => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt, endsAt }));

describe("holiday calendars", () => {
  it("computes US federal holidays, with Saturday and Sunday observed", () => {
    const us = new Map(builtInHolidays("US", 2026).map((h) => [h.name, h.date]));
    expect(us.get("Martin Luther King Jr. Day")).toBe("2026-01-19");
    expect(us.get("Memorial Day")).toBe("2026-05-25");
    expect(us.get("Labor Day")).toBe("2026-09-07");
    expect(us.get("Thanksgiving Day")).toBe("2026-11-26");
    expect(us.get("Independence Day (observed)")).toBe("2026-07-03"); // July 4, 2026 is a Saturday
    expect(builtInHolidays("US", 2027).find((h) => h.name.startsWith("Juneteenth"))?.date).toBe("2027-06-18");
  });

  it("follows Easter in the Philippines and fixed dates in Pakistan and India", () => {
    expect([easter(2026), easter(2027)]).toEqual(["2026-04-05", "2027-03-28"]);
    const ph = new Map(builtInHolidays("PH", 2026).map((h) => [h.name, h.date]));
    expect([ph.get("Maundy Thursday"), ph.get("Good Friday"), ph.get("National Heroes Day")]).toEqual(["2026-04-02", "2026-04-03", "2026-08-31"]);
    expect(builtInHolidays("PK", 2026).map((h) => h.date)).toContain("2026-08-14");
    expect(builtInHolidays("IN", 2026).map((h) => h.date)).toEqual(["2026-01-26", "2026-08-15", "2026-10-02"]);
    expect(builtInHolidays("XX", 2026)).toEqual([]);
  });
});

describe("working days, swaps and overtime", () => {
  it("counts due dates in the assignee's working days", () => {
    const night = weekdays("21:00", "06:00");
    const friday = at("2026-10-09T14:00:00Z"); // Friday 22:00 in Manila
    expect(workingDueDate(night, [], [], friday, "Asia/Manila", 1)).toBe("2026-10-12"); // Monday
    expect(workingDueDate(night, [], [{ date: "2026-10-12", name: "Company day" }], friday, "Asia/Manila", 1)).toBe("2026-10-13");
    expect(workingDueDate(night, [{ startsOn: "2026-10-12", endsOn: "2026-10-14" }], [], friday, "Asia/Manila", 2)).toBe("2026-10-16");
    expect(workingDueDate([], [], [], friday, "Asia/Manila", 3)).toBe("2026-10-12"); // no hours: calendar days
  });

  it("applies cancelled and extra hours on top of the weekly ones", () => {
    const night = weekdays("21:00", "06:00");
    const mon = at("2026-10-05T14:00:00Z"); // Monday 22:00 Manila
    expect(isWorking(night, [], mon, "Asia/Manila")).toBe(true);
    expect(isWorking(night, [{ kind: "cancel", startsAt: at("2026-10-05T13:00:00Z"), endsAt: at("2026-10-05T22:00:00Z") }], mon, "Asia/Manila")).toBe(false);
    expect(isWorking([], [{ kind: "extra", startsAt: at("2026-10-05T13:00:00Z"), endsAt: at("2026-10-05T22:00:00Z") }], mon, "Asia/Karachi")).toBe(true);
  });

  it("splits overtime by week and by day without counting an hour twice", () => {
    const fiveNines = new Map(["2030-04-01", "2030-04-02", "2030-04-03", "2030-04-04", "2030-04-05"].map((d) => [d, 9]));
    expect(splitOvertime(fiveNines, 40, null)).toEqual({ total: 45, overtime: 5, regular: 40 });
    expect(splitOvertime(fiveNines, 40, 8)).toEqual({ total: 45, overtime: 5, regular: 40 });
    const threeTwelves = new Map(["2030-04-01", "2030-04-02", "2030-04-03"].map((d) => [d, 12]));
    expect(splitOvertime(threeTwelves, 40, 8)).toEqual({ total: 36, overtime: 12, regular: 24 });
    expect(splitOvertime(threeTwelves, null, null)).toEqual({ total: 36, overtime: 0, regular: 36 });
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let manila: typeof schema.users.$inferSelect;
  let karachi: typeof schema.users.$inferSelect;
  beforeAll(async () => {
    t = await testDb();
    [manila, karachi] = await t.db.insert(schema.users).values([
      { practiceId: t.practiceId, email: "rosa.manila@example.test", passwordHash: "x", name: "Rosa Night", role: "biller" },
      { practiceId: t.practiceId, email: "imran.karachi@example.test", passwordHash: "x", name: "Imran Day", role: "biller" },
    ]).returning();
    await setTimeZone(t.db, t.practiceId, manila.id, "Asia/Manila");
    await setTimeZone(t.db, t.practiceId, karachi.id, "Asia/Karachi");
    await saveShifts(t.db, t.practiceId, manila.id, weekdays("21:00", "06:00"));
    await saveShifts(t.db, t.practiceId, karachi.id, weekdays("09:00", "18:00"));
  });
  afterAll(async () => { await t?.close(); });

  it("requests, approves and cancels time off, moving tasks out and back", async () => {
    const now = at("2030-03-01T12:00:00Z");
    await saveRule(t.db, t.practiceId, { name: "Night queue", kind: "denials", conditions: {}, assigneeIds: [manila.id, karachi.id], slaDays: 1, priority: "normal" }, t.userId);
    await applyRules(t.db, t.practiceId, { now });
    const mine = await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.assigneeId, manila.id), isNotNull(schema.tasks.ruleId)));
    expect(mine.length).toBeGreaterThan(0);
    // Due one working day out in Manila: Friday 20:00 now, so Monday.
    expect(mine.every((m) => m.dueDate === "2030-03-04")).toBe(true);

    const req = await requestTimeOff(t.db, t.practiceId, manila.id, { startsOn: "2030-03-04", endsOn: "2030-03-05", kind: "vacation", note: "Family" });
    expect(req.status).toBe("requested");
    expect((await availability(t.db, [manila.id], at("2030-03-04T02:00:00Z"))).get(manila.id)?.offToday).toBe(false); // not approved yet
    await expect(decideTimeOff(t.db, t.practiceId, req.id, true, manila.id)).rejects.toThrow(/Someone else/);
    expect(await decideTimeOff(t.db, t.practiceId, req.id, true, t.userId, now)).toBe(mine.length);
    await expect(decideTimeOff(t.db, t.practiceId, req.id, false, t.userId)).rejects.toThrow(/already decided/);
    expect((await availability(t.db, [manila.id], at("2030-03-04T02:00:00Z"))).get(manila.id)?.offToday).toBe(true);
    const moved = await t.db.select().from(schema.tasks).where(eq(schema.tasks.movedFor, req.id));
    expect(moved.every((m) => m.assigneeId === karachi.id && m.movedFrom === manila.id)).toBe(true);

    await expect(removeTimeOff(t.db, t.practiceId, req.id, manila.id, false)).rejects.toThrow(/administrator/);
    expect(await removeTimeOff(t.db, t.practiceId, req.id, t.userId, true)).toEqual({ movedBack: mine.length });
    const back = await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.assigneeId, manila.id), isNotNull(schema.tasks.ruleId)));
    expect(back.length).toBe(mine.length);
    expect(back.every((b) => b.movedFrom === null && /Moved back/.test(b.note ?? ""))).toBe(true);
  });

  it("counts holidays in each person's calendar and company holidays for everyone", async () => {
    await setHolidayCalendar(t.db, t.practiceId, manila.id, "PH");
    await expect(setHolidayCalendar(t.db, t.practiceId, karachi.id, "XX")).rejects.toThrow(/calendar/);
    const rizalDay = at("2030-12-30T02:00:00Z"); // Monday December 30 in Manila
    const a = (await availability(t.db, [manila.id, karachi.id], rizalDay));
    expect(a.get(manila.id)).toMatchObject({ offToday: true, holidayToday: "Rizal Day" });
    expect(a.get(karachi.id)?.offToday).toBe(false);
    await addHoliday(t.db, t.practiceId, { calendar: "COMPANY", onDate: "2030-12-31", name: "Year-end closing" }, t.userId);
    expect((await availability(t.db, [karachi.id], at("2030-12-31T06:00:00Z"))).get(karachi.id)).toMatchObject({ offToday: true, holidayToday: "Year-end closing" });
  });

  it("swaps a shift across time zones after the teammate accepts and an administrator approves", async () => {
    const now = at("2030-05-06T00:00:00Z"); // Monday 08:00 in Manila (May 1 is Labor Day there, so not a shift)
    const shifts = await offerableShifts(t.db, manila.id, now);
    const first = shifts[0];
    expect(first.startsAt.toISOString()).toBe("2030-05-06T13:00:00.000Z"); // Monday 21:00 Manila
    await expect(requestSwap(t.db, t.practiceId, manila.id, { startsAt: "2030-05-06T14:00:00.000Z", takerId: karachi.id }, now)).rejects.toThrow(/upcoming shifts/);
    const swap = await requestSwap(t.db, t.practiceId, manila.id, { startsAt: first.startsAt.toISOString(), takerId: karachi.id, note: "Doctor's appointment" }, now);
    expect((await offerableShifts(t.db, manila.id, now)).map((s) => s.startsAt.getTime())).not.toContain(first.startsAt.getTime());
    await expect(respondSwap(t.db, t.practiceId, swap.id, manila.id, true)).rejects.toThrow(/person asked/);
    await expect(decideSwap(t.db, t.practiceId, swap.id, t.userId, true)).rejects.toThrow(/accepted/);
    await respondSwap(t.db, t.practiceId, swap.id, karachi.id, true);
    await expect(decideSwap(t.db, t.practiceId, swap.id, karachi.id, true)).rejects.toThrow(/not in the swap/);
    await decideSwap(t.db, t.practiceId, swap.id, t.userId, true, now);
    const during = at("2030-05-06T16:00:00Z"); // Tuesday 00:00 Manila, 21:00 Monday Karachi
    const a = await availability(t.db, [manila.id, karachi.id], during);
    expect([a.get(manila.id)?.onShift, a.get(karachi.id)?.onShift]).toEqual([false, true]);
  });

  it("flags or refuses a clock-in off the office network, and takes breaks out of hours worked", async () => {
    await expect(saveClockNetworks(t.db, t.practiceId, ["not-an-ip"], "flag")).rejects.toThrow(/IP address/);
    await saveClockNetworks(t.db, t.practiceId, ["203.0.113.0/24"], "flag", t.userId);
    const flagged = await clockIn(t.db, t.practiceId, karachi.id, at("2030-06-03T04:00:00Z"), "198.51.100.7");
    expect(flagged.offNetwork).toBe(true);
    await clockOut(t.db, karachi.id, at("2030-06-03T05:00:00Z"));
    await saveClockNetworks(t.db, t.practiceId, ["203.0.113.0/24"], "require", t.userId);
    await expect(clockIn(t.db, t.practiceId, karachi.id, at("2030-06-04T04:00:00Z"), "198.51.100.7")).rejects.toThrow(/office network/);
    const ok = await clockIn(t.db, t.practiceId, karachi.id, at("2030-06-04T04:00:00Z"), "203.0.113.25");
    expect(ok.offNetwork).toBe(false);
    await startBreak(t.db, karachi.id, at("2030-06-04T06:00:00Z"));
    await expect(startBreak(t.db, karachi.id, at("2030-06-04T06:05:00Z"))).rejects.toThrow(/already on a break/);
    expect(await endBreak(t.db, karachi.id, at("2030-06-04T06:30:00Z"))).toBe(30);
    expect(await clockOut(t.db, karachi.id, at("2030-06-04T12:00:00Z"))).toMatchObject({ hours: 7.5, breakMinutes: 30 });
    const report = await hoursAndOutput(t.db, t.practiceId, "2030-06-04", "2030-06-04", at("2030-06-10T00:00:00Z"));
    expect(report.find((r) => r.userId === karachi.id)?.hours).toBe(7.5);
    await saveClockNetworks(t.db, t.practiceId, [], "flag", t.userId);
  });

  it("works out overtime and gross pay in each person's currency", async () => {
    await expect(savePay(t.db, t.practiceId, manila.id, { rateCents: 0, currency: "PHP", weeklyOtHours: 40, dailyOtHours: 8, multiplier: 1.5 })).rejects.toThrow(/hourly rate/);
    await expect(savePay(t.db, t.practiceId, manila.id, { rateCents: 50_000, currency: "XYZ", weeklyOtHours: 40, dailyOtHours: 8, multiplier: 1.5 })).rejects.toThrow(/currency/);
    await savePay(t.db, t.practiceId, manila.id, { rateCents: 50_000, currency: "PHP", weeklyOtHours: 40, dailyOtHours: 8, multiplier: 1.5 }, t.userId);
    // Monday April 1 to Friday April 5, 2030, 09:00 to 18:00 in Manila (01:00 to 10:00 UTC).
    await t.db.insert(schema.timeEntries).values(["01", "02", "03", "04", "05"].map((d) => ({ practiceId: t.practiceId, userId: manila.id, clockIn: at(`2030-04-${d}T01:00:00Z`), clockOut: at(`2030-04-${d}T10:00:00Z`) })));
    const sheet = await payWorksheet(t.db, t.practiceId, "2030-04-01", "2030-04-07", at("2030-04-10T00:00:00Z"));
    const m = sheet.find((r) => r.userId === manila.id)!;
    expect(m).toMatchObject({ total: 45, overtime: 5, regular: 40, currency: "PHP", grossCents: 40 * 50_000 + 5 * 50_000 * 1.5 });
  });
});
