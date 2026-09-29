"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { agreeRefundDemand, closeRefundDemand, createRefundDemand, disputeRefundDemand } from "@/server/refund-demands";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createRefundDemandAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const d = await createRefundDemand(await getDb(), s.practiceId, {
      claimControlNumber: f(fd, "claim"), amountCents: Math.round(Number(f(fd, "amount").replace(/[$,\s]/g, "")) * 100), receivedOn: f(fd, "receivedOn"),
      disputeBy: f(fd, "disputeBy"), offsetOn: f(fd, "offsetOn"), reference: f(fd, "reference"), notes: f(fd, "notes"),
    }, s.userId);
    revalidatePath("/refund-demands");
    return { ok: true, message: `Tracked; decide by ${d.disputeBy}.` };
  } catch (e) {
    return fail(e);
  }
}

export async function agreeRefundDemandAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await agreeRefundDemand(await getDb(), s.practiceId, id, s.userId);
    revalidatePath("/refund-demands");
    return { ok: true, message: r.note };
  } catch (e) {
    return fail(e);
  }
}

export async function disputeRefundDemandAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await disputeRefundDemand(await getDb(), s.practiceId, id, f(fd, "reason"), s.userId);
    revalidatePath("/refund-demands");
    return { ok: true, message: "Marked disputed. The letter is on the request: sign it and send it before the date." };
  } catch (e) {
    return fail(e);
  }
}

export async function closeRefundDemandAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await closeRefundDemand(await getDb(), s.practiceId, id, f(fd, "outcome"), s.userId);
    revalidatePath("/refund-demands");
    return { ok: true, message: "Closed" };
  } catch (e) {
    return fail(e);
  }
}
