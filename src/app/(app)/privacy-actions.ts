"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { completeAccessRequest, createAccessRequest, denyAccessRequest, extendAccessRequest, patientByMrn, recordDisclosure } from "@/server/disclosures";
import { markLetterSent, markReported, resolveUnclaimed, scanUnclaimed } from "@/server/unclaimed";
import { saveUnclaimedSettings } from "@/server/policies";
import { saveContractDates } from "@/server/contract-calendar";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, "") || "0") * 100);
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });

/* ------------------------------ Privacy requests and disclosures ------------------------------ */

export async function createAccessRequestAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const db = await getDb();
    const r = await createAccessRequest(db, s.practiceId, { patientId: await patientByMrn(db, s.practiceId, str(f, "mrn")), kind: str(f, "kind"), receivedOn: str(f, "receivedOn"), format: str(f, "format"), deliverTo: str(f, "deliverTo"), notes: str(f, "notes") }, s.userId);
    revalidatePath("/privacy-requests");
    return { ok: true, message: `Recorded; due ${r.dueOn}` };
  } catch (e) { return fail(e, "Could not record the request"); }
}

export async function extendAccessRequestAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const r = await extendAccessRequest(await getDb(), s.practiceId, id, str(f, "reason"), undefined, s.userId);
    revalidatePath("/privacy-requests");
    return { ok: true, message: `Extended to ${r.dueOn}. Tell the patient the reason and the new date in writing.` };
  } catch (e) { return fail(e, "Could not extend"); }
}

export async function completeAccessRequestAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await completeAccessRequest(await getDb(), s.practiceId, id, { completedOn: str(f, "completedOn"), feeCents: cents(str(f, "fee")), sentTo: str(f, "sentTo"), description: str(f, "description") }, s.userId);
    revalidatePath("/privacy-requests");
    return { ok: true, message: "Marked as provided" };
  } catch (e) { return fail(e, "Could not save"); }
}

export async function denyAccessRequestAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await denyAccessRequest(await getDb(), s.practiceId, id, str(f, "reason"), s.userId);
    revalidatePath("/privacy-requests");
    return { ok: true, message: "Recorded as denied. Send the patient the written denial with how to have it reviewed." };
  } catch (e) { return fail(e, "Could not save"); }
}

export async function recordDisclosureAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const db = await getDb();
    await recordDisclosure(db, s.practiceId, { patientId: await patientByMrn(db, s.practiceId, str(f, "mrn")), disclosedOn: str(f, "disclosedOn"), recipient: str(f, "recipient"), recipientAddress: str(f, "recipientAddress"), purpose: str(f, "purpose"), description: str(f, "description") }, s.userId);
    revalidatePath("/privacy-requests");
    return { ok: true, message: "Disclosure recorded" };
  } catch (e) { return fail(e, "Could not record the disclosure"); }
}

/* ------------------------------ Unclaimed credits ------------------------------ */

export async function saveUnclaimedSettingsAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await saveUnclaimedSettings(await getDb(), s.practiceId, { state: str(f, "state"), dormancyMonths: Number(str(f, "dormancyMonths")), letterMinCents: cents(str(f, "letterMin")) }, s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Saved. Credits past the dormancy period are listed below and checked every night." };
  } catch (e) { return fail(e, "Could not save"); }
}

export async function scanUnclaimedAction(_prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const r = await scanUnclaimed(await getDb(), s.practiceId, new Date(), s.userId);
    revalidatePath("/billing/credits");
    return r.configured ? { ok: true, message: `${r.cases.length} dormant credit${r.cases.length === 1 ? "" : "s"} to work` } : { ok: false, message: "Set the state and dormancy period first" };
  } catch (e) { return fail(e, "Could not check"); }
}

export async function unclaimedLetterSentAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await markLetterSent(await getDb(), s.practiceId, id, str(f, "sentOn") || new Date().toISOString().slice(0, 10), s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Letter recorded" };
  } catch (e) { return fail(e, "Could not save"); }
}

export async function resolveUnclaimedAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await resolveUnclaimed(await getDb(), s.practiceId, id, str(f, "resolution"), s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Closed. Refund or apply the credit as the patient asked." };
  } catch (e) { return fail(e, "Could not save"); }
}

/** Remitting to the state moves money off the patient's account, so it needs the adjust role. */
export async function reportUnclaimedAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    await markReported(await getDb(), s.practiceId, id, Number(str(f, "year")), s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Recorded as reported and remitted; the credit is off the account" };
  } catch (e) { return fail(e, "Could not save"); }
}

/* ------------------------------ Contract dates ------------------------------ */

export async function saveContractDatesAction(scheduleId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await saveContractDates(await getDb(), s.practiceId, scheduleId, { renewsOn: str(f, "renewsOn"), noticeDays: str(f, "noticeDays"), escalatorPct: str(f, "escalatorPct"), termsNotes: str(f, "termsNotes") }, s.userId);
    revalidatePath(`/settings/fees/${scheduleId}`);
    revalidatePath("/reports/contract-calendar");
    return { ok: true, message: "Saved. Administrators are reminded 60, 30 and 7 days before the notice date." };
  } catch (e) { return fail(e, "Could not save"); }
}
