"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { importResponseFile, markSent } from "@/server/clearinghouse-files";

export async function markSentAction(ids: string[], _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const n = await markSent(await getDb(), s.practiceId, ids, s.userId);
  revalidatePath("/claims");
  revalidatePath("/claims/by-file");
  return { ok: true, message: `${n} claim${n === 1 ? "" : "s"} marked as sent. Follow-up and timely filing count from today.` };
}

export async function uploadResponseAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const file = formData.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the file from your clearinghouse" };
  if (file.size > 4_000_000) return { ok: false, message: "The file is over 4 MB" };
  try {
    const r = await importResponseFile(await getDb(), s.practiceId, await file.text(), s.userId);
    revalidatePath("/claims");
    revalidatePath("/remittance");
    return { ok: true, message: r.message };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not read the file" };
  }
}

export async function saveEdiIdsAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const clean = (k: string) => String(formData.get(k) ?? "").trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "").slice(0, 15) || null;
  const submitter = clean("submitter");
  const receiver = clean("receiver");
  if (!!submitter !== !!receiver) return { ok: false, message: "Enter both IDs, or neither" };
  await (await getDb()).update(schema.practices).set({ ediSubmitterId: submitter, ediReceiverId: receiver }).where(eq(schema.practices.id, s.practiceId));
  await (await getDb()).insert(schema.auditLog).values({ practiceId: s.practiceId, userId: s.userId, action: "edi_ids_changed", entity: "practice", entityId: s.practiceId, details: { submitter, receiver } });
  revalidatePath("/claims/by-file");
  return { ok: true, message: submitter ? "Saved. Downloaded files now carry these IDs." : "Cleared" };
}
