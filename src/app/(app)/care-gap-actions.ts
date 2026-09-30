"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { awvOutreach } from "@/server/care-gaps";
import { saveChronicPrefixes } from "@/server/policies";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function awvOutreachAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const [practice] = await db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
    const r = await awvOutreach(db, s.practiceId, practice);
    revalidatePath("/reports/care-gaps");
    return { ok: true, message: `Reminders sent to ${r.sent} of ${r.due} patients due${r.skipped ? `; ${r.skipped} skipped (reminded in the last 60 days, opted out, or no way to reach them)` : ""}` };
  } catch (e) {
    return fail(e);
  }
}

export async function chronicPrefixesAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const list = String(fd.get("prefixes") ?? "").split(/[,\s]+/).map((p) => p.trim().toUpperCase().replace(".", "")).filter((p) => /^[A-Z][0-9A-Z][0-9A-Z]{0,5}$/.test(p));
    if (!list.length) throw new Error("List diagnosis prefixes such as E11, I10, N18");
    await saveChronicPrefixes(db, s.practiceId, [...new Set(list)].slice(0, 60), s.userId);
    revalidatePath("/reports/care-gaps");
    return { ok: true, message: "Chronic condition groups saved" };
  } catch (e) {
    return fail(e);
  }
}
