"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import type { FormResult } from "@/components/action-form";
import { estimateForAppointment, requestDeposit } from "@/server/pre-visit";

const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });

export async function estimateAppointmentAction(appointmentId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const cpt = String(fd.get("cpt") ?? "").trim();
    const e = await estimateForAppointment(await getDb(), s.practiceId, appointmentId, s.userId, cpt || undefined);
    revalidatePath("/scheduling/estimates");
    return { ok: true, message: `Estimate ${e.estimateNumber}: patient owes about $${(e.patientOwesCents / 100).toFixed(2)}` };
  } catch (e) {
    return fail(e, "Could not estimate");
  }
}

export async function estimateAllAction(ids: string[], _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  let made = 0;
  const problems: string[] = [];
  for (const id of ids.slice(0, 100)) {
    try {
      await estimateForAppointment(db, s.practiceId, id, s.userId);
      made++;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : "failed");
    }
  }
  revalidatePath("/scheduling/estimates");
  return { ok: made > 0, message: `${made} estimate${made === 1 ? "" : "s"} made${problems.length ? `; ${problems.length} could not be (${[...new Set(problems)].slice(0, 2).join("; ")})` : ""}` };
}

export async function requestDepositAction(estimateId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const r = await requestDeposit(await getDb(), s.practiceId, estimateId, await siteOrigin(), s.userId);
    revalidatePath("/scheduling/estimates");
    const sent = [r.sms === "sent" && "texted", r.email === "sent" && "emailed"].filter(Boolean).join(" and ");
    return { ok: true, message: sent ? `Estimate and payment link ${sent} to the patient` : `No way to reach the patient (${r.reason?.toLowerCase() ?? "no channel"}); share this link: ${r.url}` };
  } catch (e) {
    return fail(e, "Could not send");
  }
}
