"use server";

import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db";
import { requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import {
  addEntry, approveWeek, cancelCorrection, correctBreak, correctEntry, decideCorrection, deleteEntry, parseLocal, personTz, reopenWeek, requestCorrection, submitWeek,
} from "@/server/timesheets";
import { saveLeave } from "@/server/leave";
import { eq } from "drizzle-orm";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const done = (message: string): FormResult => {
  for (const p of ["/work/shifts", "/work/shifts/manage", "/work/shifts/timesheets", "/work/shifts/week", "/dashboard", "/reports/team-hours"]) revalidatePath(p);
  return { ok: true, message };
};

/** Times typed in a form are in the person's own time zone. */
async function times(userId: string, f: FormData, a = "clockIn", b = "clockOut") {
  const { tz } = await personTz(await getDb(), userId);
  return { start: parseLocal(str(f, a), tz), end: parseLocal(str(f, b), tz) };
}

async function entryOwner(entryId: string) {
  const [e] = await (await getDb()).select({ userId: schema.timeEntries.userId }).from(schema.timeEntries).where(eq(schema.timeEntries.id, entryId)).limit(1);
  if (!e) throw new Error("Entry not found");
  return e.userId;
}

/* The person */

export async function requestCorrectionAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    const t = await times(s.userId, f);
    await requestCorrection(await getDb(), s.practiceId, s.userId, { entryId: str(f, "entryId") || null, clockIn: t.start, clockOut: t.end, reason: str(f, "reason") });
    return done("Sent. An administrator will approve or deny it.");
  } catch (e) { return fail(e, "Could not send the request"); }
}

export async function cancelCorrectionAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireSession();
    await cancelCorrection(await getDb(), s.practiceId, id, s.userId);
    return done("Withdrawn");
  } catch (e) { return fail(e, "Could not withdraw"); }
}

export async function submitWeekAction(weekStart: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    const row = await submitWeek(await getDb(), s.practiceId, s.userId, weekStart, str(f, "note"));
    return done(`Submitted: ${row.hours.toFixed(2)} hours for the week of ${weekStart}`);
  } catch (e) { return fail(e, "Could not submit"); }
}

/** An administrator reopens a week; the person withdraws their own submitted week. */
export async function reopenWeekAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    await reopenWeek(await getDb(), s.practiceId, id, s.userId, s.role === "admin", str(f, "reason"));
    return done("Reopened");
  } catch (e) { return fail(e, "Could not reopen"); }
}

/* Administrators */

export async function decideCorrectionAction(id: string, approve: boolean, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await decideCorrection(await getDb(), s.practiceId, id, s.userId, approve);
    return done(approve ? "Approved: the time is corrected" : "Denied");
  } catch (e) { return fail(e, "Could not decide"); }
}

export async function approveWeekAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await approveWeek(await getDb(), s.practiceId, id, s.userId);
    return done("Approved");
  } catch (e) { return fail(e, "Could not approve"); }
}

export async function correctEntryAction(entryId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const t = await times(await entryOwner(entryId), f);
    await correctEntry(await getDb(), s.practiceId, s.userId, entryId, { clockIn: t.start, clockOut: t.end }, str(f, "reason"));
    return done("Entry corrected");
  } catch (e) { return fail(e, "Could not correct the entry"); }
}

export async function addEntryAction(userId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const t = await times(userId, f);
    await addEntry(await getDb(), s.practiceId, s.userId, userId, { clockIn: t.start, clockOut: t.end }, str(f, "reason"));
    return done("Entry added");
  } catch (e) { return fail(e, "Could not add the entry"); }
}

export async function deleteEntryAction(entryId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await deleteEntry(await getDb(), s.practiceId, s.userId, entryId, str(f, "reason"));
    return done("Entry removed");
  } catch (e) { return fail(e, "Could not remove the entry"); }
}

/** Adds a break to an entry (no `breakId`), changes one, or removes it (the "remove" field). */
export async function breakAction(entryId: string, breakId: string | null, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const remove = str(f, "remove") === "1";
    const t = remove ? null : await times(await entryOwner(entryId), f, "startsAt", "endsAt");
    await correctBreak(await getDb(), s.practiceId, s.userId, { breakId: breakId ?? undefined, entryId }, t && { startsAt: t.start, endsAt: t.end }, str(f, "reason"));
    return done(remove ? "Break removed" : breakId ? "Break corrected" : "Break added");
  } catch (e) { return fail(e, "Could not change the break"); }
}

export async function leaveAction(userId: string, kind: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const days = str(f, "days");
    await saveLeave(await getDb(), s.practiceId, userId, kind, { daysPerYear: days === "" ? null : Number(days), accrual: str(f, "accrual"), carryOver: Number(str(f, "carryOver") || 0) }, s.userId);
    return done(days === "" ? "Allowance removed" : "Allowance saved");
  } catch (e) { return fail(e, "Could not save the allowance"); }
}
