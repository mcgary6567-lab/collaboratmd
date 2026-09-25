"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_ADJUST, requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { deleteReport, saveReport } from "@/server/report-builder";
import { builderQuery, looksLikePhi, namesFor, parseQuestion } from "@/server/ask-data";
import { askWithAi } from "@/lib/ai/ask-data";
import { practiceConfig } from "@/server/integrations";

export async function saveReportAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  const f = (k: string) => String(formData.get(k) ?? "");
  let id: string;
  try {
    const row = await saveReport(await getDb(), s.practiceId, {
      id: f("id") || null,
      name: f("name"),
      dataset: f("dataset"),
      config: { columns: formData.getAll("col").map(String), group: f("group") || null, range: f("range"), payerId: f("payer") || null, providerId: f("provider") || null, status: f("status") || null },
      schedule: f("schedule"),
      recipients: f("recipients").split(/[,;\s]+/),
    }, s.userId);
    id = row.id;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not save" };
  }
  revalidatePath("/reports/builder");
  redirect(`/reports/builder?id=${id}&saved=1`);
}

export async function deleteReportAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_ADJUST);
  await deleteReport(await getDb(), s.practiceId, id, s.userId);
  revalidatePath("/reports/builder");
  redirect("/reports/builder");
}

/** "Ask your data": the answer is a normal report-builder report, opened in the builder. */
export async function askDataAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireSession();
  const question = String(formData.get("q") ?? "").trim().slice(0, 300);
  if (!question) return { ok: false, message: "Type a question" };
  const db = await getDb();
  const cfg = await practiceConfig(db, s.practiceId);
  const ai = cfg.anthropic;
  if (ai && !ai.phiAllowed && looksLikePhi(question)) {
    return { ok: false, message: "That looks like it includes a date of birth, member ID or record number. Leave patient details out; reports cover the whole practice." };
  }
  const { payers, providers } = await namesFor(db, s.practiceId);
  const answer = (await askWithAi(question, payers, providers, ai?.apiKey)) ?? parseQuestion(question, payers, providers);
  if (!answer) return { ok: false, message: "Couldn't tell which report answers that. Mention claims, denials, payments or charges, for example: \"denials by payer last 90 days\"." };
  redirect(`/reports/builder?${builderQuery(answer, question)}`);
}
