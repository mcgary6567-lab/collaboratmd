"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { closeLegacyItem, importLegacyAr } from "@/server/legacy-ar";

export async function importLegacyAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Choose the CSV file" };
  if (file.size > 10_000_000) return { ok: false, message: "Files are limited to 10 MB; split larger ones" };
  try {
    const r = await importLegacyAr(await getDb(), s.practiceId, await file.text(), String(fd.get("batch") ?? ""), s.userId);
    revalidatePath("/billing/legacy");
    const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const problems = r.problems.length ? ` ${r.problems.length} rows skipped (first: row ${r.problems[0].row}, ${r.problems[0].message.toLowerCase()}).` : "";
    return { ok: r.imported > 0, message: `Imported ${r.imported} balances: ${usd(r.patientCents)} patient (now on the ledger), ${usd(r.insuranceCents)} insurance (to work here).${problems}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not import" };
  }
}

export async function closeLegacyAction(id: string, status: "collected" | "written_off", _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    await closeLegacyItem(await getDb(), s.practiceId, id, status, s.userId);
    revalidatePath("/billing/legacy");
    return { ok: true, message: status === "collected" ? "Marked collected" : "Written off" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not update" };
  }
}
