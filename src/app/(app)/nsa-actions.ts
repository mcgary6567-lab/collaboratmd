"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { closeNsaDispute, createNsaDispute, startIdr, startNegotiation } from "@/server/nsa-disputes";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const cents = (v: string) => (v ? Math.round(Number(v.replace(/[$,\s]/g, "")) * 100) : null);

export async function createNsaDisputeAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await createNsaDispute(await getDb(), s.practiceId, { claimControlNumber: f(fd, "claim"), initialResponseOn: f(fd, "initialResponseOn"), offerCents: cents(f(fd, "offer")), notes: f(fd, "notes") }, s.userId);
    revalidatePath("/nsa-disputes");
    return { ok: true, message: "Tracked. Send the open negotiation notice before the date shown." };
  } catch (e) {
    return fail(e);
  }
}

export async function startNegotiationAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await startNegotiation(await getDb(), s.practiceId, id, f(fd, "sentOn"), s.userId);
    revalidatePath("/nsa-disputes");
    return { ok: true, message: r.late ? "Recorded, but after the 30-business-day limit: the plan may refuse to negotiate." : "Open negotiation started" };
  } catch (e) {
    return fail(e);
  }
}

export async function startIdrAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const r = await startIdr(await getDb(), s.practiceId, id, f(fd, "initiatedOn"), s.userId);
    revalidatePath("/nsa-disputes");
    return { ok: true, message: r.late ? "Recorded, but after the 4-business-day window." : "IDR started" };
  } catch (e) {
    return fail(e);
  }
}

export async function closeNsaDisputeAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await closeNsaDispute(await getDb(), s.practiceId, id, { outcome: f(fd, "outcome"), settledCents: cents(f(fd, "settled")) }, s.userId);
    revalidatePath("/nsa-disputes");
    return { ok: true, message: "Closed" };
  } catch (e) {
    return fail(e);
  }
}
