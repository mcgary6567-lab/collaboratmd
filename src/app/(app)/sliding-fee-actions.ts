"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assertOwned } from "@/server/tenancy";
import { recordSlidingFee, saveGuidelines, saveTiers } from "@/server/sliding-fee";
import { money } from "@/lib/utils";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, "")) * 100);

export async function saveGuidelinesAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    await saveGuidelines(await getDb(), s.practiceId, { year: Number(f(fd, "year")), baseCents: cents(f(fd, "base")), perPersonCents: cents(f(fd, "perPerson")) });
    revalidatePath("/settings/sliding-fee");
    return { ok: true, message: "Guidelines saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function saveTiersAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const max = fd.getAll("maxPercent").map(String);
    const disc = fd.getAll("discountPercent").map(String);
    const labels = fd.getAll("label").map(String);
    await saveTiers(await getDb(), s.practiceId, max.map((m, i) => ({ maxPercent: Number(m) || 0, discountPercent: Number(disc[i]) || 0, label: labels[i] })));
    revalidatePath("/settings/sliding-fee");
    return { ok: true, message: "Tiers saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function recordSlidingFeeAction(patientId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "patient", patientId);
    const r = await recordSlidingFee(db, s.practiceId, patientId, { householdSize: Number(f(fd, "household")), annualIncomeCents: cents(f(fd, "income")), proof: f(fd, "proof"), verifiedOn: f(fd, "verifiedOn") }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: r.discountPercent ? `${r.percent}% of the poverty guideline: ${r.discountPercent}% discount until ${r.expiresOn}${r.posted ? `; ${money(r.posted)} taken off what the patient owes` : ""}` : `${r.percent}% of the poverty guideline: above the sliding fee scale` };
  } catch (e) {
    return fail(e);
  }
}
