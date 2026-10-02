"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assignableUsers } from "@/server/work";
import { addTimeOff, clockIn, clockOut, removeTimeOff, saveHandover, saveShifts, setTimeZone, WEEKDAYS, type Shift } from "@/server/shifts";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const done = (message: string): FormResult => { revalidatePath("/work/shifts"); revalidatePath("/dashboard"); return { ok: true, message }; };

/** Administrators manage anyone on the practice's team; everyone else only themselves. */
async function teamMember(userId: string, adminOnly = true) {
  const s = adminOnly ? await requireRole(["admin"]) : await requireSession();
  if (s.role !== "admin" && userId !== s.userId) throw new Error("You can only change your own");
  const db = await getDb();
  if (!(await assignableUsers(db, s.practiceId)).some((u) => u.id === userId)) throw new Error("That person is not on this practice's team");
  return { s, db };
}

export async function timeZoneAction(userId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const { s, db } = await teamMember(userId, false);
    await setTimeZone(db, s.practiceId, userId, str(f, "timeZone"), s.userId);
    return done("Time zone saved");
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

export async function timeOffAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const userId = str(f, "userId");
    const { s, db } = await teamMember(userId);
    const r = await addTimeOff(db, s.practiceId, { userId, startsOn: str(f, "startsOn"), endsOn: str(f, "endsOn"), kind: str(f, "kind"), note: str(f, "note") }, s.userId);
    return done(r.moved ? `Time off saved; ${r.moved} open task${r.moved === 1 ? "" : "s"} moved to teammates` : "Time off saved");
  } catch (e) { return fail(e, "Could not save the time off"); }
}

export async function removeTimeOffAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await removeTimeOff(await getDb(), s.practiceId, id, s.userId);
    return done("Removed");
  } catch (e) { return fail(e, "Could not remove"); }
}

export async function clockAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    const db = await getDb();
    if (str(f, "to") === "in") {
      await clockIn(db, s.practiceId, s.userId);
      return done("Clocked in");
    }
    const r = await clockOut(db, s.userId, new Date(), str(f, "note"));
    return done(r.capped ? `Clocked out. The entry was open too long, so it counts ${r.hours} hours; ask an administrator to correct it if needed.` : `Clocked out after ${r.hours.toFixed(1)} hours`);
  } catch (e) { return fail(e, "Could not clock in or out"); }
}

export async function handoverAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    await saveHandover(await getDb(), s.practiceId, s.userId, { done: str(f, "done"), inProgress: str(f, "inProgress"), problems: str(f, "problems") });
    return done("Handover saved for the next shift");
  } catch (e) { return fail(e, "Could not save the handover"); }
}
