import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { applyRules, saveRule } from "./work-rules";
import {
  addTimeOff, availability, clockIn, clockOut, coverageGaps, hoursAndOutput, isOffOn, isOnShift, localClock, nextShiftStart, pickAssignee,
  recentHandovers, saveHandover, saveShifts, setTimeZone, teamBoard, zonedMoment, type Shift,
} from "./shifts";

const at = (iso: string) => new Date(iso);
const weekdays = (startsAt: string, endsAt: string): Shift[] => [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startsAt, endsAt }));

describe("time zones and shifts", () => {
  it("reads the local day and time in a person's time zone", () => {
    expect(localClock(at("2026-10-05T04:00:00Z"), "Asia/Kolkata")).toMatchObject({ date: "2026-10-05", weekday: 1, time: "09:30" });
    expect(localClock(at("2026-10-05T02:00:00Z"), "America/New_York")).toMatchObject({ date: "2026-10-04", weekday: 0, time: "22:00" });
  });

  it("knows a day shift and an overnight shift that crosses midnight", () => {
    const day = weekdays("09:00", "17:00");
    expect(isOnShift(day, at("2026-10-05T04:00:00Z"), "Asia/Kolkata")).toBe(true); // Monday 09:30 in India
    expect(isOnShift(day, at("2026-10-05T12:00:00Z"), "Asia/Kolkata")).toBe(false); // 17:30
    // A Manila night shift that covers the US business day: 21:00 to 06:00.
    const night = weekdays("21:00", "06:00");
    expect(isOnShift(night, at("2026-10-05T13:30:00Z"), "Asia/Manila")).toBe(true); // Monday 21:30 Manila = 09:30 New York
    expect(isOnShift(night, at("2026-10-05T21:00:00Z"), "Asia/Manila")).toBe(true); // Tuesday 05:00 Manila, still Monday's shift
    expect(isOnShift(night, at("2026-10-05T23:30:00Z"), "Asia/Manila")).toBe(false); // Tuesday 07:30
    expect(isOnShift(night, at("2026-10-09T21:00:00Z"), "Asia/Manila")).toBe(true); // Saturday 05:00: the end of Friday's shift
    expect(isOnShift(night, at("2026-10-10T21:00:00Z"), "Asia/Manila")).toBe(false); // Sunday 05:00: Saturday has no shift
    expect(isOnShift(night, at("2026-10-11T21:00:00Z"), "Asia/Manila")).toBe(false); // Monday 05:00: Sunday had no shift
  });

  it("finds the real moment of a local time, and the next shift after days off", () => {
    expect(zonedMoment("2026-10-05", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-10-05T03:30:00.000Z");
    expect(zonedMoment("2026-11-02", "09:00", "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z"); // after daylight saving ends
    const night = weekdays("21:00", "06:00");
    const saturdayMorning = at("2026-10-09T23:00:00Z"); // Saturday 07:00 in Manila
    expect(nextShiftStart(night, [], saturdayMorning, "Asia/Manila")?.toISOString()).toBe("2026-10-12T13:00:00.000Z"); // Monday 21:00 Manila
    expect(nextShiftStart(night, [{ startsOn: "2026-10-12", endsOn: "2026-10-12" }], saturdayMorning, "Asia/Manila")?.toISOString()).toBe("2026-10-13T13:00:00.000Z");
    expect(nextShiftStart([], [], saturdayMorning, "Asia/Manila")).toBeNull();
    expect(isOffOn([{ startsOn: "2026-10-12", endsOn: "2026-10-14" }], "2026-10-14")).toBe(true);
  });

  it("skips people who are off in the rotation, unless everyone is", () => {
    const avail = new Map([["a", { offToday: true }], ["b", { offToday: false }], ["c", { offToday: false }]] as [string, never][]);
    expect(pickAssignee(["a", "b", "c"], 0, avail)).toEqual({ assigneeId: "b", next: 2 });
    expect(pickAssignee(["a", "b", "c"], 2, avail)).toEqual({ assigneeId: "c", next: 3 });
    const allOff = new Map([["a", { offToday: true }], ["b", { offToday: true }]] as [string, never][]);
    expect(pickAssignee(["a", "b"], 1, allOff)).toEqual({ assigneeId: "b", next: 2 });
  });
});

describe("against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let manila: typeof schema.users.$inferSelect;
  let karachi: typeof schema.users.$inferSelect;
  beforeAll(async () => {
    t = await testDb();
    [manila, karachi] = await t.db.insert(schema.users).values([
      { practiceId: t.practiceId, email: "night.biller@example.test", passwordHash: "x", name: "Rosa Night", role: "biller" },
      { practiceId: t.practiceId, email: "day.biller@example.test", passwordHash: "x", name: "Imran Day", role: "biller" },
    ]).returning();
  });
  afterAll(async () => { await t?.close(); });

  it("keeps time zones and weekly hours, and shows who is on now", async () => {
    await expect(setTimeZone(t.db, t.practiceId, manila.id, "Mars/Olympus")).rejects.toThrow(/time zone/);
    await setTimeZone(t.db, t.practiceId, manila.id, "Asia/Manila", t.userId);
    await setTimeZone(t.db, t.practiceId, karachi.id, "Asia/Karachi");
    await expect(saveShifts(t.db, t.practiceId, manila.id, [{ weekday: 1, startsAt: "21:00", endsAt: "21:00" }])).rejects.toThrow(/same time/);
    await expect(saveShifts(t.db, t.practiceId, manila.id, [{ weekday: 1, startsAt: "9pm", endsAt: "06:00" }])).rejects.toThrow(/HH:MM/);
    await saveShifts(t.db, t.practiceId, manila.id, weekdays("21:00", "06:00"), t.userId);
    await saveShifts(t.db, t.practiceId, karachi.id, weekdays("09:00", "18:00"));
    const now = at("2026-10-05T14:00:00Z"); // Monday: 22:00 Manila, 19:00 Karachi
    const board = await teamBoard(t.db, t.practiceId, now);
    const m = board.find((b) => b.id === manila.id)!, k = board.find((b) => b.id === karachi.id)!;
    expect([m.onShift, m.localTime, m.tz]).toEqual([true, "22:00", "Asia/Manila"]);
    expect([k.onShift, k.localTime]).toEqual([false, "19:00"]);
    expect(k.nextStart?.toISOString()).toBe("2026-10-06T04:00:00.000Z"); // Tuesday 09:00 Karachi
    // Someone with no hours set counts as always available.
    const admin = board.find((b) => b.id === t.userId);
    expect(admin?.onShift).toBe(true);
  });

  it("skips people off today when handing out work, and moves their tasks when time off is recorded", async () => {
    const now = at("2030-03-01T12:00:00Z"); // Friday: 20:00 Manila, 17:00 Karachi
    await addTimeOff(t.db, t.practiceId, { userId: manila.id, startsOn: "2030-03-01", endsOn: "2030-03-01", kind: "sick" }, t.userId, now);
    await saveRule(t.db, t.practiceId, { name: "Offshore denials", kind: "denials", conditions: {}, assigneeIds: [manila.id, karachi.id], slaDays: 1, priority: "normal" }, t.userId);
    const made = await applyRules(t.db, t.practiceId, { now });
    expect(made["Offshore denials"]).toBeGreaterThan(0);
    const assigned = await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.practiceId, t.practiceId), isNotNull(schema.tasks.ruleId)));
    expect(assigned.every((x) => x.assigneeId === karachi.id)).toBe(true);

    // Karachi takes leave over the due date: the tasks move back to Manila, who is back by then.
    expect(await coverageGaps(t.db, t.practiceId, now)).toMatchObject({ uncovered: [], stranded: [] });
    const r = await addTimeOff(t.db, t.practiceId, { userId: karachi.id, startsOn: "2030-03-02", endsOn: "2030-03-08", kind: "vacation", note: "Eid" }, t.userId, now);
    expect(r.moved).toBe(assigned.length);
    const after = await t.db.select().from(schema.tasks).where(and(eq(schema.tasks.practiceId, t.practiceId), isNotNull(schema.tasks.ruleId)));
    expect(after.every((x) => x.assigneeId === manila.id && /Moved from Imran Day/.test(x.note ?? ""))).toBe(true);

    // Both off on the same day: the queue has nobody, and tasks due by tomorrow are stranded.
    const later = at("2030-03-04T12:00:00Z");
    await addTimeOff(t.db, t.practiceId, { userId: manila.id, startsOn: "2030-03-04", endsOn: "2030-03-04", kind: "holiday" }, t.userId, later);
    const gaps = await coverageGaps(t.db, t.practiceId, later);
    expect(gaps.uncovered.map((u) => u.name)).toEqual(["Offshore denials"]);
    expect(gaps.stranded.length).toBeGreaterThan(0);
    expect((await availability(t.db, [karachi.id], later)).get(karachi.id)?.offToday).toBe(true);
  });

  it("clocks in and out, caps a forgotten clock-out, and reports output per hour", async () => {
    await clockIn(t.db, t.practiceId, manila.id, at("2030-04-01T13:00:00Z"));
    await expect(clockIn(t.db, t.practiceId, manila.id, at("2030-04-01T14:00:00Z"))).rejects.toThrow(/already clocked in/);
    expect(await clockOut(t.db, manila.id, at("2030-04-01T21:00:00Z"))).toMatchObject({ hours: 8, capped: false });
    await expect(clockOut(t.db, manila.id, at("2030-04-01T22:00:00Z"))).rejects.toThrow(/not clocked in/);
    await clockIn(t.db, t.practiceId, karachi.id, at("2030-04-02T04:00:00Z"));
    expect(await clockOut(t.db, karachi.id, at("2030-04-03T12:00:00Z"))).toMatchObject({ hours: 16, capped: true });
    await t.db.insert(schema.tasks).values([
      { practiceId: t.practiceId, title: "Work denial A", assigneeId: manila.id, status: "done", completedAt: at("2030-04-01T15:00:00Z") },
      { practiceId: t.practiceId, title: "Work denial B", assigneeId: manila.id, status: "done", completedAt: at("2030-04-01T16:00:00Z") },
    ]);
    const report = await hoursAndOutput(t.db, t.practiceId, "2030-04-01", "2030-04-03", at("2030-04-05T00:00:00Z"));
    const m = report.find((r) => r.userId === manila.id)!;
    expect(m).toMatchObject({ hours: 8, tasks: 2 });
    expect(m.tasksPerHour).toBeCloseTo(0.25);
    expect(report.find((r) => r.userId === karachi.id)?.hours).toBe(16);
  });

  it("passes a handover note to the next shift", async () => {
    await expect(saveHandover(t.db, t.practiceId, manila.id, { done: " " })).rejects.toThrow(/at least one line/);
    await saveHandover(t.db, t.practiceId, manila.id, { done: "Posted 3 ERAs", inProgress: "Aetna appeal for claim C-1009 half written", problems: "Clearinghouse slow after 02:00" });
    const notes = await recentHandovers(t.db, t.practiceId);
    expect(notes[0]).toMatchObject({ name: "Rosa Night", h: { inProgress: "Aetna appeal for claim C-1009 half written" } });
  });
});
