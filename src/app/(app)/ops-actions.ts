"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { accessFor, CAN_ADJUST, requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { closePeriod, reopenPeriod, saveAccountNames, ACCOUNTS } from "@/server/accounting";
import { createInvoice, saveAgreement, setInvoiceStatus } from "@/server/client-billing";
import { applyRules, saveRule, setRuleActive } from "@/server/work-rules";

const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });

/** Invoicing reaches across clients, so the check is admin in the client practice, not the current one. */
async function adminIn(practiceId: string) {
  const s = await requireSession();
  const access = await accessFor(await getDb(), s.userId, practiceId);
  if (access?.role !== "admin") throw new Error("You need to be an administrator of that practice");
  return s;
}

export async function saveAgreementAction(practiceId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  try {
    const s = await adminIn(practiceId);
    const n = (k: string) => Number(String(formData.get(k) ?? "").replace(/[$,%\s]/g, ""));
    await saveAgreement(await getDb(), practiceId, {
      issuerName: String(formData.get("issuerName") ?? ""), issuerAddress: String(formData.get("issuerAddress") ?? ""),
      ratePct: n("ratePct"), minimumCents: Math.round((n("minimum") || 0) * 100), includePatient: formData.get("includePatient") === "on", termsDays: n("termsDays"),
    }, s.userId);
    revalidatePath("/clients/invoicing");
    return { ok: true, message: "Agreement saved" };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function createInvoiceAction(practiceId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  try {
    const s = await adminIn(practiceId);
    const inv = await createInvoice(await getDb(), practiceId, String(formData.get("period") ?? ""), s.userId);
    revalidatePath("/clients/invoicing");
    return { ok: true, message: `Invoice ${inv.number} created as a draft` };
  } catch (e) {
    return fail(e, "Could not create the invoice");
  }
}

export async function invoiceStatusAction(practiceId: string, id: string, status: "sent" | "paid" | "void", _prev: FormResult): Promise<FormResult> {
  try {
    const s = await adminIn(practiceId);
    await setInvoiceStatus(await getDb(), practiceId, id, status, s.userId);
    revalidatePath("/clients/invoicing");
    revalidatePath(`/clients/invoicing/${id}`);
    return { ok: true, message: `Marked ${status}` };
  } catch (e) {
    return fail(e, "Could not update");
  }
}

export async function accountNamesAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await saveAccountNames(await getDb(), s.practiceId, Object.fromEntries(Object.keys(ACCOUNTS).map((k) => [k, String(formData.get(k) ?? "")])));
  revalidatePath("/billing/accounting");
  return { ok: true, message: "Account names saved" };
}

export async function closePeriodAction(period: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await closePeriod(await getDb(), s.practiceId, period, s.userId);
    revalidatePath("/billing/accounting");
    return { ok: true, message: `${period} closed` };
  } catch (e) {
    return fail(e, "Could not close the month");
  }
}

export async function reopenPeriodAction(period: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await reopenPeriod(await getDb(), s.practiceId, period, s.userId);
  revalidatePath("/billing/accounting");
  return { ok: true, message: `${period} reopened` };
}

export async function saveRuleAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    await saveRule(await getDb(), s.practiceId, {
      name: String(formData.get("name") ?? ""), kind: String(formData.get("kind") ?? ""),
      conditions: {
        payerIds: formData.getAll("payerIds").map(String).filter(Boolean),
        minCents: Math.round(Number(String(formData.get("min") ?? "0").replace(/[$,\s]/g, "")) * 100) || 0,
        categories: formData.getAll("categories").map(String).filter(Boolean),
        minAgeDays: Number(formData.get("minAgeDays") ?? 30),
      },
      assigneeIds: formData.getAll("assigneeIds").map(String), slaDays: Number(formData.get("slaDays")), priority: String(formData.get("priority") ?? "normal"),
    }, s.userId);
    revalidatePath("/work");
    return { ok: true, message: "Rule saved. It runs every morning, or now with Run rules." };
  } catch (e) {
    return fail(e, "Could not save the rule");
  }
}

export async function ruleActiveAction(id: string, active: boolean, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await setRuleActive(await getDb(), s.practiceId, id, active);
  revalidatePath("/work");
  return { ok: true, message: active ? "Rule on" : "Rule paused" };
}

export async function runRulesAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const r = await applyRules(await getDb(), s.practiceId);
  revalidatePath("/work");
  revalidatePath("/tasks");
  const total = Object.values(r).reduce((a, n) => a + n, 0);
  return { ok: true, message: total ? `Assigned ${total} new task${total === 1 ? "" : "s"}` : "Nothing new to assign" };
}
