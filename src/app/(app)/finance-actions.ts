"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { familyPayment, setGuarantor, setQmb, writeOffQmbCostSharing } from "@/server/patient-accounts";
import { closeDay } from "@/server/cash-close";
import { recordAgencyRecovery, setCommission } from "@/server/collections";
import { chargeFee, recordFeePolicySigned, saveFeePolicy, waiveFee } from "@/server/missed-fees";
import { setRootCause } from "@/server/denial-causes";
import { importChargemaster, markReviewed } from "@/server/chargemaster";
import { savePlan } from "@/server/compensation";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const cents = (v: string) => (v ? Math.round(Number(v.replace(/[$,\s]/g, "")) * 100) : 0);
const num = (v: string) => (v === "" ? null : Number(v));
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const done = (paths: string[], message: string): FormResult => { for (const p of paths) revalidatePath(p); return { ok: true, message }; };

/* QMB and family accounts */

export async function setQmbAction(insuranceId: string, patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await setQmb(await getDb(), s.practiceId, insuranceId, { qmb: f.get("qmb") === "on", verifiedOn: str(f, "verifiedOn") }, s.userId);
    return done([`/patients/${patientId}`], f.get("qmb") === "on" ? "Marked QMB: Medicare cost-sharing is left off the patient's bills" : "QMB status removed");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function writeOffQmbAction(patientId: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    const r = await writeOffQmbCostSharing(await getDb(), s.practiceId, patientId, s.userId);
    return done([`/patients/${patientId}`], r.claims ? `Wrote off $${(r.cents / 100).toFixed(2)} on ${r.claims} claim${r.claims === 1 ? "" : "s"}` : "Nothing to write off");
  } catch (e) { return fail(e, "Could not write off"); }
}

export async function setGuarantorAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await setGuarantor(await getDb(), s.practiceId, patientId, str(f, "guarantorMrn") || null, s.userId);
    return done([`/patients/${patientId}`], str(f, "guarantorMrn") ? "Guarantor set: statements go to them" : "Guarantor removed");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function familyPaymentAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const applied = await familyPayment(await getDb(), s.practiceId, patientId, cents(str(f, "amount")), str(f, "method") || "card", s.userId);
    return done([`/patients/${patientId}`], `Applied to ${applied.length} account${applied.length === 1 ? "" : "s"}`);
  } catch (e) { return fail(e, "Could not post the payment"); }
}

/* Daily cash close */

export async function closeDayAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const r = await closeDay(await getDb(), s.practiceId, { day: str(f, "day"), countedCashCents: cents(str(f, "cash")), countedChecksCents: cents(str(f, "checks")), cardBatchCents: cents(str(f, "cards")), depositReference: str(f, "deposit"), notes: str(f, "notes") }, s.userId);
    const off = Object.values(r.variance).some((v) => v !== 0);
    return done(["/billing/cash-close"], off ? "Closed with a difference, explained in the notes" : "Closed: the drawer and batch match what was posted");
  } catch (e) { return fail(e, "Could not close the day"); }
}

/* Collection agencies */

export async function agencyRecoveryAction(collectionId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    const commission = str(f, "commission");
    const r = await recordAgencyRecovery(await getDb(), s.practiceId, collectionId, { receivedOn: str(f, "receivedOn"), grossCents: cents(str(f, "gross")), commissionCents: commission ? cents(commission) : undefined, reference: str(f, "reference") }, s.userId);
    return done(["/billing/collections", "/reports/agencies"], `Posted $${(r.grossCents / 100).toFixed(2)} to the patient; the agency kept $${(r.commissionCents / 100).toFixed(2)}`);
  } catch (e) { return fail(e, "Could not post the recovery"); }
}

export async function commissionAction(collectionId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    await setCommission(await getDb(), s.practiceId, collectionId, num(str(f, "pct")));
    return done(["/billing/collections"], "Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Missed-appointment fees */

export async function saveFeePolicyAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await saveFeePolicy(await getDb(), s.practiceId, { noShowCents: cents(str(f, "noShow")), lateCancelCents: cents(str(f, "lateCancel")), lateCancelHours: Number(str(f, "hours")) }, s.userId);
    return done(["/billing/missed-fees"], "Saved. Online check-in now asks patients to agree to it.");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function chargeFeeAction(appointmentId: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await chargeFee(await getDb(), s.practiceId, appointmentId, s.userId);
    return done(["/billing/missed-fees"], "Fee charged to the patient");
  } catch (e) { return fail(e, "Could not charge the fee"); }
}

export async function waiveFeeAction(feeId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await waiveFee(await getDb(), s.practiceId, feeId, str(f, "reason"), s.userId);
    return done(["/billing/missed-fees"], "Waived");
  } catch (e) { return fail(e, "Could not waive the fee"); }
}

export async function feePolicySignedAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await recordFeePolicySigned(await getDb(), s.practiceId, patientId, str(f, "signedOn"), s.userId);
    return done([`/patients/${patientId}`], "Recorded");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Denial root causes */

export async function rootCauseAction(denialId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await setRootCause(await getDb(), s.practiceId, denialId, str(f, "cause"), s.userId);
    return done(["/reports/denial-causes"], "Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Chargemaster */

export async function importChargemasterAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the chargemaster file (CSV)" };
    if (file.size > 5_000_000) return { ok: false, message: "That file is larger than 5 MB" };
    const n = await importChargemaster(await getDb(), s.practiceId, await file.text(), s.userId);
    return done(["/settings/chargemaster"], `Loaded ${n} items`);
  } catch (e) { return fail(e, "Could not load the file"); }
}

export async function reviewChargemasterAction(_prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await markReviewed(await getDb(), s.practiceId, s.userId);
    return done(["/settings/chargemaster"], "Marked as reviewed today");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Provider compensation */

export async function savePlanAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin"]);
    await savePlan(await getDb(), s.practiceId, {
      providerId: str(f, "providerId"), kind: str(f, "kind"), baseCents: cents(str(f, "base")), collectionsPct: num(str(f, "pct")),
      perRvuCents: str(f, "perRvu") ? cents(str(f, "perRvu")) : null, threshold: num(str(f, "threshold")), effectiveFrom: str(f, "effectiveFrom"), notes: str(f, "notes"),
    }, s.userId);
    return done(["/reports/compensation"], "Plan saved");
  } catch (e) { return fail(e, "Could not save the plan"); }
}
