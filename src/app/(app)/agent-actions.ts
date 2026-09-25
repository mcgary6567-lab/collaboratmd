"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { approveItem, dismissItem, runDenialAgent } from "@/server/denial-agent";

const PATH = "/denials/agent";
const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function runAgentAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await runDenialAgent(await getDb(), s.practiceId, { limit: 25, userId: s.userId });
    revalidatePath(PATH);
    revalidatePath("/denials");
    return { ok: true, message: r.prepared ? `Prepared ${r.prepared} denial${r.prepared === 1 ? "" : "s"} for review${r.failed ? ` (${r.failed} skipped)` : ""}` : "No new open denials to work" };
  } catch (e) {
    return fail(e);
  }
}

export async function approveAgentItemAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await approveItem(await getDb(), s.practiceId, id, s.userId, s.role);
    revalidatePath(PATH);
    revalidatePath("/denials");
    return { ok: true, message: r.message };
  } catch (e) {
    return fail(e);
  }
}

export async function dismissAgentItemAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await dismissItem(await getDb(), s.practiceId, id, s.userId);
    revalidatePath(PATH);
    return { ok: true, message: "Dismissed; the denial is back in the open queue" };
  } catch (e) {
    return fail(e);
  }
}
