"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { clientIp } from "@/lib/ip";
import type { FormResult } from "@/components/action-form";
import { pendingDocuments, recordAcceptance } from "@/server/legal";

export async function acceptTermsAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  if (fd.get("agree") !== "on") return { ok: false, message: "Tick the box to accept" };
  const db = await getDb();
  const docs = await pendingDocuments(db, s.practiceId, s.userId);
  if (docs.length) await recordAcceptance(db, { practiceId: s.practiceId, userId: s.userId, ip: clientIp(await headers()), documents: docs });
  revalidatePath("/", "layout");
  return { ok: true, message: "Thank you" };
}
