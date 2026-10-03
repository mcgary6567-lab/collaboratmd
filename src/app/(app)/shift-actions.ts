"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole, requireSession } from "@/lib/auth";
import { clientIp } from "@/lib/ip";
import type { FormResult } from "@/components/action-form";
import { assignableUsers } from "@/server/work";
import {
  addTimeOff, clockIn, clockOut, decideTimeOff, endBreak, removeTimeOff, requestTimeOff, saveClockNetworks, saveHandover, saveShifts,
  setHolidayCalendar, setTimeZone, startBreak, WEEKDAYS, type Shift,
} from "@/server/shifts";
import { cancelSwap, decideSwap, requestSwap, respondSwap } from "@/server/shift-swaps";
import { addHoliday, removeHoliday } from "@/server/holidays";
import { savePay } from "@/server/pay";
import { leaveCheck } from "@/server/leave";
import { weekOpenForClock } from "@/server/timesheets";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string) => (v === "" ? null : Number(v));
/** Dates, kind and part of the day from a time-off form; a part day is the first day only. */
const timeOffInput = (f: FormData) => {
  const part = str(f, "part") || "full";
  return { startsOn: str(f, "startsOn"), endsOn: part === "full" ? str(f, "endsOn") : str(f, "startsOn"), kind: str(f, "kind"), note: str(f, "note"), part, fromTime: str(f, "fromTime"), toTime: str(f, "toTime") };
};
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const done = (message: string): FormResult => {
  for (const p of ["/work/shifts", "/work/shifts/manage", "/work/shifts/timesheets", "/work/shifts/week", "/dashboard", "/reports/team-hours"]) revalidatePath(p);
  return { ok: true, message };
};

/** Administrators manage anyone on the practice's team; everyone else only themselves. */
async function teamMember(userId: string, adminOnly = true) {
  const s = adminOnly ? await requireRole(["admin"]) : await requireSession();
  if (s.role !== "admin" && userId !== s.userId) throw new Error("You can only change your own");
  const db = await getDb();
  if (!(await assignableUsers(db, s.practiceId)).some((u) => u.id === userId)) throw new Error("That person is not on this practice's team");
  return { s, db };
}

/* Schedules */

export async function timeZoneAction(userId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const { s, db } = await teamMember(userId, false);
    await setTimeZone(db, s.practiceId, userId, str(f, "timeZone"), s.userId);
    return done("Time zone saved");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function holidayCalendarAction(userId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const { s, db } = await teamMember(userId);
    await setHolidayCalendar(db, s.practiceId, userId, str(f, "calendar"), s.userId);
    return done("Holiday calendar saved");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function shiftsAction(userId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const { s, db } = await teamMember(userId);
    const shifts: Shift[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const startsAt = str(f, `start-${weekday}`), endsAt = str(f, `end-${weekday}`);
      if (!startsAt && !endsAt) continue;
      if (!startsAt || !endsAt) throw new Error(`${WEEKDAYS[weekday]}: enter both the start and the end`);
      shifts.push({ weekday, startsAt, endsAt });
    }
    await saveShifts(db, s.practiceId, userId, shifts, s.userId);
    return done(shifts.length ? `Saved ${shifts.length} shift${shifts.length === 1 ? "" : "s"} a week` : "Weekly hours cleared: always available");
  } catch (e) { return fail(e, "Could not save the shifts"); }
}

/* Time off */

export async function timeOffAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const userId = str(f, "userId");
    const { s, db } = await teamMember(userId);
    const r = await addTimeOff(db, s.practiceId, { userId, ...timeOffInput(f) }, s.userId);
    return done(r.moved ? `Time off saved; ${r.moved} open task${r.moved === 1 ? "" : "s"} moved to teammates` : "Time off saved");
  } catch (e) { return fail(e, "Could not save the time off"); }
}

export async function requestTimeOffAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    const db = await getDb();
    const row = await requestTimeOff(db, s.practiceId, s.userId, timeOffInput(f));
    const check = await leaveCheck(db, s.userId, row, new Date(), row.id);
    const over = check.after !== null && check.after < 0 ? ` This is ${-check.after} day${check.after === -1 ? "" : "s"} over your balance.` : "";
    return done(`Requested (${check.days} working day${check.days === 1 ? "" : "s"}). An administrator will approve or deny it.${over}`);
  } catch (e) { return fail(e, "Could not send the request"); }
}

export async function decideTimeOffAction(id: string, approve: boolean, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const moved = await decideTimeOff(await getDb(), s.practiceId, id, approve, s.userId);
    return done(approve ? (moved ? `Approved; ${moved} open task${moved === 1 ? "" : "s"} moved to teammates` : "Approved") : "Denied");
  } catch (e) { return fail(e, "Could not decide"); }
}

export async function removeTimeOffAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireSession();
    const r = await removeTimeOff(await getDb(), s.practiceId, id, s.userId, s.role === "admin");
    return done(r.movedBack ? `Cancelled; ${r.movedBack} task${r.movedBack === 1 ? "" : "s"} moved back` : "Cancelled");
  } catch (e) { return fail(e, "Could not cancel"); }
}

/* Swaps */

export async function requestSwapAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    await requestSwap(await getDb(), s.practiceId, s.userId, { startsAt: str(f, "startsAt"), takerId: str(f, "takerId"), note: str(f, "note") });
    return done("Asked. Your teammate accepts, then an administrator approves.");
  } catch (e) { return fail(e, "Could not ask"); }
}

export async function respondSwapAction(id: string, accept: boolean, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireSession();
    await respondSwap(await getDb(), s.practiceId, id, s.userId, accept);
    return done(accept ? "Accepted; waiting for an administrator" : "Declined");
  } catch (e) { return fail(e, "Could not answer"); }
}

export async function decideSwapAction(id: string, approve: boolean, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await decideSwap(await getDb(), s.practiceId, id, s.userId, approve);
    return done(approve ? "Approved: the shift moves" : "Denied");
  } catch (e) { return fail(e, "Could not decide"); }
}

export async function cancelSwapAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireSession();
    await cancelSwap(await getDb(), s.practiceId, id, s.userId);
    return done("Withdrawn");
  } catch (e) { return fail(e, "Could not withdraw"); }
}

/* Holidays, networks and pay (administrators) */

export async function addHolidayAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await addHoliday(await getDb(), s.practiceId, { calendar: str(f, "calendar"), onDate: str(f, "onDate"), name: str(f, "name") }, s.userId);
    return done("Holiday added");
  } catch (e) { return fail(e, "Could not add"); }
}

export async function removeHolidayAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await removeHoliday(await getDb(), s.practiceId, id, s.userId);
    return done("Removed");
  } catch (e) { return fail(e, "Could not remove"); }
}

export async function clockNetworksAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await saveClockNetworks(await getDb(), s.practiceId, str(f, "networks").split(/[\s,]+/), str(f, "mode"), s.userId);
    return done("Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function payAction(userId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const { s, db } = await teamMember(userId);
    await savePay(db, s.practiceId, userId, {
      rateCents: Math.round(Number(str(f, "rate").replace(/[,\s]/g, "")) * 100), currency: str(f, "currency"),
      weeklyOtHours: num(str(f, "weekly")), dailyOtHours: num(str(f, "daily")), multiplier: Number(str(f, "multiplier") || 1.5),
      nightPct: num(str(f, "nightPct")), nightStart: str(f, "nightStart"), nightEnd: str(f, "nightEnd"), holidayMultiplier: num(str(f, "holidayMultiplier")),
    }, s.userId);
    return done("Pay saved");
  } catch (e) { return fail(e, "Could not save the pay"); }
}

/* Clock, breaks and handover */

export async function clockAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    const db = await getDb();
    const to = str(f, "to");
    if (to === "in") {
      const now = new Date();
      const week = await weekOpenForClock(db, s.userId, now);
      const entry = await clockIn(db, s.practiceId, s.userId, now, clientIp(await headers()));
      const notes = [
        entry.offNetwork ? "You are not on an office network, so this entry is flagged for your administrator." : "",
        week.withdrawn ? "This week's submitted timesheet was taken back: submit it again at the end of the week." : "",
      ].filter(Boolean).join(" ");
      return done(notes ? `Clocked in. ${notes}` : "Clocked in");
    }
    if (to === "break") {
      await startBreak(db, s.userId);
      return done("On a break");
    }
    if (to === "back") {
      const minutes = await endBreak(db, s.userId);
      return done(`Back from a ${Math.round(minutes)}-minute break`);
    }
    const r = await clockOut(db, s.userId, new Date(), str(f, "note"));
    return done(r.capped ? `Clocked out. The entry was open too long, so it counts ${r.hours.toFixed(1)} hours; ask an administrator to correct it if needed.` : `Clocked out after ${r.hours.toFixed(1)} hours worked${r.breakMinutes ? ` (${r.breakMinutes} minutes of breaks)` : ""}`);
  } catch (e) { return fail(e, "Could not clock in or out"); }
}

export async function handoverAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    await saveHandover(await getDb(), s.practiceId, s.userId, { done: str(f, "done"), inProgress: str(f, "inProgress"), problems: str(f, "problems") });
    return done("Handover saved for the next shift");
  } catch (e) { return fail(e, "Could not save the handover"); }
}
