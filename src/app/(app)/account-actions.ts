"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { closeHold, recordBankruptcy, recordClaimFiled, recordDeath } from "@/server/account-holds";
import { markMailReturned, recordAdultConsent, releaseAdultDependent, updateAddress } from "@/server/account-review";
import { setReferralSource } from "@/server/referrals";
import { closeComplaint, logComplaint, updateInvestigation } from "@/server/privacy-complaints";
import { COST_CATEGORIES, saveCosts } from "@/server/cost-to-collect";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const cents = (v: string) => (v ? Math.round(Number(v.replace(/[$,\s]/g, "")) * 100) : 0);
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const done = (paths: string[], message: string): FormResult => { for (const p of paths) revalidatePath(p); return { ok: true, message }; };
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/* Bankruptcy and deceased patients */

export async function recordBankruptcyAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await recordBankruptcy(await getDb(), s.practiceId, { patientId, chapter: str(f, "chapter"), caseNumber: str(f, "caseNumber"), court: str(f, "court"), filedOn: str(f, "filedOn"), deadline: str(f, "deadline") || undefined, notes: str(f, "notes") }, s.userId);
    return done([`/patients/${patientId}`, "/billing/holds"], "Bankruptcy recorded: collection activity has stopped");
  } catch (e) { return fail(e, "Could not record the bankruptcy"); }
}

export async function recordDeathAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const r = await recordDeath(await getDb(), s.practiceId, { patientId, diedOn: str(f, "diedOn"), executor: str(f, "executor"), executorAddress: str(f, "executorAddress"), probateCourt: str(f, "probateCourt"), deadline: str(f, "deadline") || undefined, notes: str(f, "notes") }, s.userId);
    return done([`/patients/${patientId}`, "/billing/holds"], `Recorded. Billing stops${r.cancelledAppointments ? `; ${r.cancelledAppointments} future visit${r.cancelledAppointments === 1 ? "" : "s"} cancelled` : ""}`);
  } catch (e) { return fail(e, "Could not record the death"); }
}

export async function claimFiledAction(holdId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await recordClaimFiled(await getDb(), s.practiceId, holdId, str(f, "filedOn"), s.userId);
    return done(["/billing/holds"], "Claim filing recorded");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function closeHoldAction(holdId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    const r = await closeHold(await getDb(), s.practiceId, holdId, { outcome: str(f, "outcome"), paidCents: cents(str(f, "paid")), method: str(f, "method") }, s.userId);
    return done(["/billing/holds"], r.writtenOffCents ? `Closed; ${money(r.writtenOffCents)} written off` : "Closed; billing resumes");
  } catch (e) { return fail(e, "Could not close"); }
}

/* Returned mail and adult dependents */

export async function mailReturnedAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await markMailReturned(await getDb(), s.practiceId, patientId, { on: str(f, "on"), note: str(f, "note") }, s.userId);
    return done([`/patients/${patientId}`, "/patients/account-review"], "Marked: nothing more is mailed there until the address is corrected");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function updateAddressAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await updateAddress(await getDb(), s.practiceId, patientId, { address1: str(f, "address1"), city: str(f, "city"), state: str(f, "state"), zip: str(f, "zip") }, s.userId);
    return done([`/patients/${patientId}`, "/patients/account-review"], "Address saved");
  } catch (e) { return fail(e, "Could not save the address"); }
}

export async function adultConsentAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await recordAdultConsent(await getDb(), s.practiceId, patientId, str(f, "on"), s.userId);
    return done([`/patients/${patientId}`, "/patients/account-review"], "Recorded: statements stay with the guarantor");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function releaseAdultAction(patientId: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await releaseAdultDependent(await getDb(), s.practiceId, patientId, s.userId);
    return done([`/patients/${patientId}`, "/patients/account-review"], "The patient is now billed on their own account");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Referral sources */

export async function referralAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await setReferralSource(await getDb(), s.practiceId, patientId, str(f, "source"), str(f, "detail"), s.userId);
    return done([`/patients/${patientId}`], "Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Privacy complaints */

export async function logComplaintAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await logComplaint(await getDb(), s.practiceId, { receivedOn: str(f, "receivedOn"), channel: str(f, "channel"), complainant: str(f, "complainant"), patientMrn: str(f, "mrn"), category: str(f, "category"), description: str(f, "description") }, s.userId);
    return done(["/privacy-complaints"], "Complaint logged");
  } catch (e) { return fail(e, "Could not log the complaint"); }
}

export async function investigationAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    await updateInvestigation(await getDb(), s.practiceId, id, { investigation: str(f, "investigation"), finding: str(f, "finding") || undefined, mitigation: str(f, "mitigation"), sanctions: str(f, "sanctions") }, s.userId);
    return done(["/privacy-complaints"], "Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function closeComplaintAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    await closeComplaint(await getDb(), s.practiceId, id, str(f, "respondedOn"), s.userId);
    return done(["/privacy-complaints"], "Complaint closed");
  } catch (e) { return fail(e, "Could not close"); }
}

/* Cost to collect */

export async function saveCostsAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const values = Object.fromEntries(Object.keys(COST_CATEGORIES).map((k) => [k, cents(str(f, k))]));
    await saveCosts(await getDb(), s.practiceId, str(f, "month"), values, s.userId);
    return done(["/reports/cost-to-collect"], "Costs saved");
  } catch (e) { return fail(e, "Could not save the costs"); }
}
