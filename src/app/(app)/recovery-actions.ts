"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { createClaimForEncounter } from "@/server/claims";
import { approveRefund, cancelRefund, dismissMissedCharge, issueRefund, markDisputed, recordRecovery, requestRefund } from "@/server/recovery";

const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const cents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? "").replace(/[$,\s]/g, "")) * 100);

export async function dismissMissedChargeAction(appointmentId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await dismissMissedCharge(await getDb(), s.practiceId, appointmentId, String(formData.get("reason") ?? ""), s.userId);
    revalidatePath("/billing/missed-charges");
    return { ok: true, message: "Marked not billable" };
  } catch (e) {
    return fail(e, "Could not dismiss the visit");
  }
}

export async function markDisputedAction(ids: string[], _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const n = await markDisputed(await getDb(), s.practiceId, ids, s.userId);
  revalidatePath("/underpayments");
  return { ok: true, message: n ? `${n} underpayment${n === 1 ? "" : "s"} moved to Appealed` : "Already marked as sent" };
}

export async function recordRecoveryAction(id: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await recordRecovery(await getDb(), s.practiceId, id, cents(formData.get("amount")), s.userId);
    revalidatePath("/underpayments");
    return { ok: true, message: "Recovery recorded" };
  } catch (e) {
    return fail(e, "Could not record the recovery");
  }
}

export async function requestRefundAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await requestRefund(await getDb(), s.practiceId, {
      payee: formData.get("payee") === "payer" ? "payer" : "patient",
      patientId: String(formData.get("patientId") ?? "") || undefined,
      claimId: String(formData.get("claimId") ?? "") || undefined,
      amountCents: cents(formData.get("amount")),
      reason: String(formData.get("reason") ?? ""),
    }, s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Refund requested; an administrator approves it next" };
  } catch (e) {
    return fail(e, "Could not request the refund");
  }
}

export async function approveRefundAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    await approveRefund(await getDb(), s.practiceId, id, s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Approved" };
  } catch (e) {
    return fail(e, "Could not approve");
  }
}

export async function issueRefundAction(id: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await issueRefund(await getDb(), s.practiceId, id, { method: String(formData.get("method") ?? "check"), reference: String(formData.get("reference") ?? "") }, s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Issued and posted to the ledger" };
  } catch (e) {
    return fail(e, "Could not issue the refund");
  }
}

export async function cancelRefundAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await cancelRefund(await getDb(), s.practiceId, id, s.userId);
    revalidatePath("/billing/credits");
    return { ok: true, message: "Cancelled" };
  } catch (e) {
    return fail(e, "Could not cancel");
  }
}

export async function claimMissedEncounterAction(encounterId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const [enc] = await db.select({ id: schema.encounters.id }).from(schema.encounters).where(and(eq(schema.encounters.id, encounterId), eq(schema.encounters.practiceId, s.practiceId))).limit(1);
    if (!enc) throw new Error("Encounter not found");
    const [existing] = await db.select({ id: schema.claims.id }).from(schema.claims).where(eq(schema.claims.encounterId, encounterId)).limit(1);
    if (existing) throw new Error("This encounter already has a claim");
    const claim = await createClaimForEncounter(db, encounterId, s.userId);
    revalidatePath("/billing/missed-charges");
    return { ok: true, message: `Claim ${claim.controlNumber} created and scrubbed; submit it from Claims` };
  } catch (e) {
    return fail(e, "Could not create the claim");
  }
}
