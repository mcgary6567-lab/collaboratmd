"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { createIntegrationKey, processHl7, revokeIntegrationKey } from "@/server/hl7";
import { importPatients, preview, profiles, readTable, type ImportPreview } from "@/server/import";
import { mapColumnsWithAi } from "@/lib/ai/map-columns";
import { practiceConfig } from "@/server/integrations";
import type { Mapping } from "@/lib/import/patients";

const fail = (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : "Something went wrong" });

/* ------------------------------- HL7 ------------------------------- */

export type KeyResult = (FormResult & { key?: string }) | undefined;

export async function createKeyAction(_prev: KeyResult, formData: FormData): Promise<KeyResult> {
  const s = await requireRole(["admin"]);
  try {
    const db = await getDb();
    const { key } = await createIntegrationKey(db, s.practiceId, String(formData.get("name") ?? ""), s.userId);
    revalidatePath("/settings/integrations");
    return { ok: true, key, message: "Copy this key now. It is shown only once; if it is lost, revoke it and create another." };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeKeyAction(id: string): Promise<void> {
  const s = await requireRole(["admin"]);
  const db = await getDb();
  await revokeIntegrationKey(db, s.practiceId, id, s.userId);
  revalidatePath("/settings/integrations");
}

/** Processes a pasted message exactly as the API would, for testing an interface. */
export async function testHl7Action(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const r = await processHl7(db, s.practiceId, String(formData.get("message") ?? ""), { source: "manual", userId: s.userId });
    revalidatePath("/settings/integrations");
    return { ok: r.status !== "error", message: `${r.status === "processed" ? "Processed" : r.status === "duplicate" ? "Duplicate" : "Error"}: ${r.message}` };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------ Import ------------------------------ */

export type PreviewResult = { ok: true; preview: ImportPreview; aiAvailable: boolean } | { ok: false; message: string };

export async function previewImportAction(text: string, mapping?: Mapping): Promise<PreviewResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const cfg = await practiceConfig(await getDb(), s.practiceId);
    return { ok: true, preview: preview(readTable(text), mapping), aiAvailable: !!cfg.anthropic };
  } catch (e) {
    return fail(e);
  }
}

/** Maps columns with Claude from headers and value shapes only; no patient data is sent. */
export async function aiMapAction(text: string): Promise<PreviewResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const table = readTable(text);
    const mapped = await mapColumnsWithAi(profiles(table), (await practiceConfig(await getDb(), s.practiceId)).anthropic?.apiKey);
    if (!mapped) return { ok: false, message: "AI mapping is not available right now; the rule-based mapping is unchanged" };
    return { ok: true, preview: preview(table, mapped), aiAvailable: true };
  } catch (e) {
    return fail(e);
  }
}

export type ImportResult =
  | { ok: true; created: number; updated: number; skipped: number; total: number; issues: { row: number; message: string }[] }
  | { ok: false; message: string };

export async function runImportAction(filename: string, text: string, mapping: Mapping, mappedBy: "rules" | "ai" | "user"): Promise<ImportResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const job = await importPatients(db, s.practiceId, { filename, text, mapping, mappedBy, userId: s.userId });
    revalidatePath("/patients");
    revalidatePath("/import");
    return { ok: true, created: job.created, updated: job.updated, skipped: job.skipped, total: job.totalRows, issues: job.errors.slice(0, 100) };
  } catch (e) {
    return fail(e);
  }
}
