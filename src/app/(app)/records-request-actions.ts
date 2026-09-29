"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { closeRecordsRequest, createRecordsRequest, markRecordsSent } from "@/server/records-requests";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function createRecordsRequestAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const r = await createRecordsRequest(await getDb(), s.practiceId, { kind: f(fd, "kind"), claimControlNumber: f(fd, "claim"), reference: f(fd, "reference"), receivedOn: f(fd, "receivedOn"), dueOn: f(fd, "dueOn"), notes: f(fd, "notes") }, s.userId);
    revalidatePath("/records-requests");
    return { ok: true, message: `Tracked; due ${r.dueOn}.${r.claimId ? " The claim is held from appeals and write-offs until the records are sent." : ""}` };
  } catch (e) {
    return fail(e);
  }
}

export async function recordsSentAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await markRecordsSent(await getDb(), s.practiceId, id, { sentOn: f(fd, "sentOn"), sentVia: f(fd, "sentVia") }, s.userId);
    revalidatePath("/records-requests");
    return { ok: true, message: "Marked sent" };
  } catch (e) {
    return fail(e);
  }
}

export async function closeRecordsRequestAction(id: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await closeRecordsRequest(await getDb(), s.practiceId, id, f(fd, "outcome"), s.userId);
    revalidatePath("/records-requests");
    return { ok: true, message: "Closed" };
  } catch (e) {
    return fail(e);
  }
}
