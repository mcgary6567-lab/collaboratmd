"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { cancelOpenShift, claimOpenShift, decideOpenShift, postOpenShift, unclaimOpenShift } from "@/server/open-shifts";
import { createWorkAudit, reviewWorkItem } from "@/server/work-quality";
import { recordTraining, removeTraining } from "@/server/staff-training";
import { METRICS, saveTargets } from "@/server/targets";
import { personTz } from "@/server/timesheets";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const done = (message: string): FormResult => {
  for (const p of ["/work/shifts", "/work/shifts/week", "/work/shifts/manage", "/work/quality", "/work/training", "/dashboard", "/reports/team-hours"]) revalidatePath(p);
  return { ok: true, message };
};

/* Open shifts */

export async function postOpenShiftAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const db = await getDb();
    const { tz } = await personTz(db, s.userId);
    await postOpenShift(db, s.practiceId, s.userId, { date: str(f, "date"), from: str(f, "from"), to: str(f, "to"), note: str(f, "note") }, tz);
    return done("Posted. The team is told and anyone can claim it.");
  } catch (e) { return fail(e, "Could not post the shift"); }
}

export async function claimOpenShiftAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireSession();
    await claimOpenShift(await getDb(), s.practiceId, id, s.userId);
    return done("Claimed. An administrator confirms it.");
  } catch (e) { return fail(e, "Could not claim it"); }
}

export async function unclaimOpenShiftAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireSession();
    await unclaimOpenShift(await getDb(), s.practiceId, id, s.userId);
    return done("Withdrawn");
  } catch (e) { return fail(e, "Could not withdraw"); }
}

export async function decideOpenShiftAction(id: string, approve: boolean, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await decideOpenShift(await getDb(), s.practiceId, id, s.userId, approve);
    return done(approve ? "Confirmed: it is on their schedule" : "Turned down: the shift is open again");
  } catch (e) { return fail(e, "Could not decide"); }
}

export async function cancelOpenShiftAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await cancelOpenShift(await getDb(), s.practiceId, id, s.userId);
    return done("Cancelled");
  } catch (e) { return fail(e, "Could not cancel"); }
}

/* Quality checks */

export async function createWorkAuditAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const r = await createWorkAudit(await getDb(), s.practiceId, s.userId, { from: str(f, "from"), to: str(f, "to"), perPerson: Number(str(f, "perPerson")) });
    return done(`Sample drawn: ${r.items} item${r.items === 1 ? "" : "s"} to check`);
  } catch (e) { return fail(e, "Could not draw the sample"); }
}

export async function reviewWorkItemAction(itemId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin", "biller"]);
    await reviewWorkItem(await getDb(), s.practiceId, itemId, s.userId, { result: str(f, "result"), finding: str(f, "finding"), note: str(f, "note") });
    return done("Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Training */

export async function recordTrainingAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireSession();
    const userId = str(f, "userId") || s.userId;
    await recordTraining(await getDb(), s.practiceId, s.userId, s.role === "admin", {
      userId, kind: str(f, "kind"), name: str(f, "name"), completedOn: str(f, "completedOn"), expiresOn: str(f, "expiresOn"), credentialNo: str(f, "credentialNo"),
    });
    return done(userId === s.userId ? "Signed and recorded" : "Recorded");
  } catch (e) { return fail(e, "Could not record it"); }
}

export async function removeTrainingAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await removeTraining(await getDb(), s.practiceId, id, s.userId);
    return done("Removed");
  } catch (e) { return fail(e, "Could not remove it"); }
}

/* Targets */

export async function targetsAction(userId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const values = Object.fromEntries(Object.keys(METRICS).map((m) => [m, str(f, m) === "" ? null : Number(str(f, m))]));
    await saveTargets(await getDb(), s.practiceId, userId, values, s.userId);
    return done("Targets saved");
  } catch (e) { return fail(e, "Could not save the targets"); }
}
