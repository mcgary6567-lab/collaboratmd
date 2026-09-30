"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole, requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { mergePatients } from "@/server/patient-merge";
import { answerQuery, askProvider, withdrawQuery } from "@/server/coding-queries";
import { createAudit, scoreItem } from "@/server/coding-audits";
import { dropInjuryCase, openInjuryCase, recordReduction, settleInjuryCase } from "@/server/injury-cases";
import { patientByMrn } from "@/server/disclosures";
import { saveThreshold } from "@/server/therapy-threshold";
import { isPlatformOperator } from "@/server/code-sets";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const cents = (v: string) => (v ? Math.round(Number(v.replace(/[$,\s]/g, "")) * 100) : null);
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });

/* ------------------------------ Duplicate patients ------------------------------ */

export async function mergePatientsAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  const s = await requireRole(["admin", "biller"]);
  const [a, b] = [str(f, "a"), str(f, "b")];
  const keep = str(f, "keep");
  if (keep !== a && keep !== b) return { ok: false, message: "Choose which record to keep" };
  try {
    const r = await mergePatients(await getDb(), s.practiceId, keep, keep === a ? b : a, s.userId);
    revalidatePath("/patients/duplicates");
    return { ok: true, message: `Merged ${r.merged} into ${r.kept}` };
  } catch (e) { return fail(e, "Could not merge"); }
}

/* ------------------------------ Questions to providers ------------------------------ */

export async function askProviderAction(encounterId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await askProvider(await getDb(), s.practiceId, { encounterId, topic: str(f, "topic"), question: str(f, "question") }, s.userId);
    revalidatePath("/coding/queries");
    return { ok: true, message: "Question sent; the claim is held until it is answered" };
  } catch (e) { return fail(e, "Could not send the question"); }
}

export async function answerQueryAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await answerQuery(await getDb(), s.practiceId, id, str(f, "answer"), s.userId);
    revalidatePath("/coding/queries");
    return { ok: true, message: "Answer recorded. Correct the claim if needed, then scrub it again." };
  } catch (e) { return fail(e, "Could not save"); }
}

export async function withdrawQueryAction(id: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await withdrawQuery(await getDb(), s.practiceId, id, s.userId);
    revalidatePath("/coding/queries");
    return { ok: true, message: "Withdrawn" };
  } catch (e) { return fail(e, "Could not withdraw"); }
}

/* ------------------------------ Coding audits ------------------------------ */

export async function createAuditAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  const s = await requireRole(["admin", "biller"]);
  let id: string;
  try {
    id = (await createAudit(await getDb(), s.practiceId, { name: str(f, "name"), fromDate: str(f, "fromDate"), toDate: str(f, "toDate"), perProvider: Number(str(f, "perProvider")) }, s.userId)).audit.id;
  } catch (e) { return fail(e, "Could not create the audit"); }
  redirect(`/coding/audits/${id}`);
}

export async function scoreItemAction(auditId: string, itemId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin", "biller"]);
    await scoreItem(await getDb(), s.practiceId, itemId, { result: str(f, "result") as "correct" | "error", finding: str(f, "finding"), billedCode: str(f, "billedCode"), correctCode: str(f, "correctCode"), note: str(f, "note") }, s.userId);
    revalidatePath(`/coding/audits/${auditId}`);
    return { ok: true, message: "Saved" };
  } catch (e) { return fail(e, "Could not save"); }
}

/* ------------------------------ Personal injury cases ------------------------------ */

export async function openInjuryCaseAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const db = await getDb();
    await openInjuryCase(db, s.practiceId, {
      patientId: await patientByMrn(db, s.practiceId, str(f, "mrn")), attorney: str(f, "attorney"), firm: str(f, "firm"), phone: str(f, "phone"), email: str(f, "email"),
      caseNumber: str(f, "caseNumber"), accidentOn: str(f, "accidentOn") || undefined, lienSignedOn: str(f, "lienSignedOn"), notes: str(f, "notes"),
    }, s.userId);
    revalidatePath("/injury-cases");
    return { ok: true, message: "Case opened; the patient's balance is held from statements and collections" };
  } catch (e) { return fail(e, "Could not open the case"); }
}

export async function injuryReductionAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    await recordReduction(await getDb(), s.practiceId, id, { requestedCents: cents(str(f, "requested")), agreedCents: cents(str(f, "agreed")) }, s.userId);
    revalidatePath("/injury-cases");
    return { ok: true, message: "Saved" };
  } catch (e) { return fail(e, "Could not save"); }
}

export async function settleInjuryCaseAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_ADJUST);
    const r = await settleInjuryCase(await getDb(), s.practiceId, id, { settledOn: str(f, "settledOn"), paidCents: cents(str(f, "paid")) ?? -1, method: str(f, "method") }, s.userId);
    revalidatePath("/injury-cases");
    return { ok: true, message: `Settled and posted. Balance now $${(r.balanceCents / 100).toFixed(2)}; normal billing resumes for anything left.` };
  } catch (e) { return fail(e, "Could not settle"); }
}

export async function dropInjuryCaseAction(id: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await dropInjuryCase(await getDb(), s.practiceId, id, str(f, "reason"), s.userId);
    revalidatePath("/injury-cases");
    return { ok: true, message: "Closed; normal billing resumes" };
  } catch (e) { return fail(e, "Could not close"); }
}

/* ------------------------------ Therapy threshold (platform operator) ------------------------------ */

export async function saveThresholdAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  const s = await requireSession();
  if (!isPlatformOperator(s.email)) return { ok: false, message: "Only the platform operator can enter national amounts" };
  try {
    await saveThreshold(await getDb(), { year: Number(str(f, "year")), kxCents: cents(str(f, "kx")) ?? 0, reviewCents: cents(str(f, "review")) }, s.email);
    revalidatePath("/settings/code-sets");
    return { ok: true, message: "Saved; Medicare therapy claims are checked against it" };
  } catch (e) { return fail(e, "Could not save"); }
}
