"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { deletePromptPayRule, markInterestRequested, savePromptPayRule } from "@/server/prompt-pay";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function savePromptPayRuleAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    await savePromptPayRule(await getDb(), s.practiceId, { state: f(fd, "state"), days: Number(f(fd, "days")), annualRatePct: Number(f(fd, "rate")), citation: f(fd, "citation") }, s.userId);
    revalidatePath("/settings/prompt-pay");
    return { ok: true, message: "Saved. Late commercial payments are listed on Underpayments." };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePromptPayRuleAction(state: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await deletePromptPayRule(await getDb(), s.practiceId, state);
  revalidatePath("/settings/prompt-pay");
  return { ok: true, message: "Removed" };
}

export async function markInterestRequestedAction(payerId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const n = await markInterestRequested(await getDb(), s.practiceId, payerId, s.userId);
    revalidatePath("/underpayments");
    return { ok: true, message: `${n} claim${n === 1 ? "" : "s"} marked as asked; the next letter leaves them out.` };
  } catch (e) {
    return fail(e);
  }
}
