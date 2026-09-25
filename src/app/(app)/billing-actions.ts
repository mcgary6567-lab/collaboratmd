"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import {
  applyDiscount, cancelPlan, createEstimate, createPaymentPlan, createPolicy, generateStatement, generateStatementBatch,
  markStatementSent, recordPlanPayment, setPolicyActive, voidStatement,
} from "@/server/billing";
import { getPolicies } from "@/server/policies";

const ok = (message: string): FormResult => ({ ok: true, message });
const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const dollars = (v: FormDataEntryValue | null) => Math.round(parseFloat(String(v ?? "0")) * 100);

/* ----------------------------- Discounts ----------------------------- */

export async function applyDiscountAction(patientId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    const entry = await applyDiscount(db, s.practiceId, patientId, String(formData.get("policyId") ?? ""), s.userId);
    revalidatePath(`/patients/${patientId}`);
    return ok(`Discount of $${(entry.amountCents / 100).toFixed(2)} posted`);
  } catch (e) {
    return fail(e);
  }
}

export async function createPolicyAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireSession();
  if (s.role !== "admin") return { ok: false, message: "Only an administrator can create discount policies" };
  try {
    const db = await getDb();
    await createPolicy(db, s.practiceId, {
      name: String(formData.get("name") ?? ""),
      kind: String(formData.get("kind") ?? "courtesy"),
      percent: Number(formData.get("percent") ?? 0),
    });
    revalidatePath("/billing");
    return ok("Policy added");
  } catch (e) {
    return fail(e);
  }
}

export async function togglePolicyAction(id: string, active: boolean): Promise<void> {
  const s = await requireSession();
  if (s.role !== "admin") return;
  const db = await getDb();
  await setPolicyActive(db, s.practiceId, id, active);
  revalidatePath("/billing");
}

/* --------------------------- Payment plans --------------------------- */

export async function createPlanAction(patientId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const frequency = String(formData.get("frequency")) === "biweekly" ? "biweekly" : "monthly";
    await createPaymentPlan(db, s.practiceId, patientId, {
      totalCents: dollars(formData.get("total")),
      installmentCount: Number(formData.get("count") ?? 0),
      frequency,
      startDate: String(formData.get("startDate") ?? ""),
      note: String(formData.get("note") ?? ""),
    }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/billing");
    return ok("Payment plan created");
  } catch (e) {
    return fail(e);
  }
}

export async function planPaymentAction(planId: string, patientId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const r = await recordPlanPayment(db, s.practiceId, planId, dollars(formData.get("amount")), String(formData.get("method") ?? "card"), s.userId);
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/billing");
    if (r.completed) return ok("Payment posted. The plan is paid in full.");
    return ok(r.leftoverCents > 0 ? `Payment posted; $${(r.leftoverCents / 100).toFixed(2)} beyond the plan stays as account credit` : "Payment posted");
  } catch (e) {
    return fail(e);
  }
}

export async function cancelPlanAction(planId: string, patientId: string): Promise<void> {
  const s = await requireRole(CAN_ADJUST);
  const db = await getDb();
  await cancelPlan(db, s.practiceId, planId);
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/billing");
}

/* ----------------------------- Statements ---------------------------- */

export async function generateStatementAction(patientId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  let id: string;
  try {
    const db = await getDb();
    id = (await generateStatement(db, s.practiceId, patientId, s.userId)).id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/statements/${id}`);
}

export async function statementBatchAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const policies = await getPolicies(db, s.practiceId);
    const r = await generateStatementBatch(db, s.practiceId, { minBalanceCents: dollars(formData.get("min")) || policies.statementMinCents || 500, skipDays: policies.statementIntervalDays ?? 25 }, s.userId);
    revalidatePath("/billing");
    return ok(`${r.generated} statements generated, ${r.skipped} skipped as recently billed`);
  } catch (e) {
    return fail(e);
  }
}

export async function markStatementSentAction(id: string, channel: "print" | "email"): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await markStatementSent(db, s.practiceId, id, channel);
  revalidatePath(`/statements/${id}`);
  revalidatePath("/billing");
}

export async function voidStatementAction(id: string): Promise<void> {
  const s = await requireRole(CAN_ADJUST);
  const db = await getDb();
  await voidStatement(db, s.practiceId, id);
  revalidatePath(`/statements/${id}`);
}

/* ----------------------------- Estimates ----------------------------- */

export async function createEstimateAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const cpts = formData.getAll("cpt").map(String);
  const units = formData.getAll("units").map((u) => Number(u) || 0);
  const insurance = String(formData.get("patientInsuranceId") ?? "");
  let id: string;
  try {
    const db = await getDb();
    const est = await createEstimate(db, s.practiceId, {
      patientId: String(formData.get("patientId") ?? ""),
      patientInsuranceId: insurance === "self_pay" || insurance === "" ? null : insurance,
      serviceDate: String(formData.get("serviceDate") ?? "") || null,
      lines: cpts.map((cpt, i) => ({ cpt, units: units[i] ?? 1 })).filter((l) => l.cpt),
    }, s.userId);
    id = est.id;
  } catch (e) {
    return fail(e);
  }
  redirect(`/estimates/${id}`);
}

/** Text-to-pay: sends secure pay links to patients with a balance, respecting consent and opt-outs. */
export async function sendPayLinksAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const minCents = Math.round(Number(String(formData.get("min") ?? "25").replace(/[$,]/g, "")) * 100);
  if (!Number.isFinite(minCents) || minCents < 100) return { ok: false, message: "Enter a minimum balance of at least $1" };
  try {
    const { siteOrigin } = await import("@/lib/origin");
    const { sendPayLinks } = await import("@/server/automation");
    const r = await sendPayLinks(await getDb(), s.practiceId, await siteOrigin(), { minCents });
    revalidatePath("/billing");
    return { ok: true, message: `${r.sent} pay link${r.sent === 1 ? "" : "s"} sent${r.skipped ? `, ${r.skipped} could not be reached (no email or text consent)` : ""}${r.excluded ? `, ${r.excluded} skipped (on a plan, in collections or messaged this week)` : ""}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not send" };
  }
}
