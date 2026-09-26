"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { removeFhir, saveFhir, syncFhir, testFhir } from "@/server/fhir";

const admin = () => requireRole(["admin"]);
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });

export async function saveFhirAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await saveFhir(await getDb(), s.practiceId, { baseUrl: String(fd.get("baseUrl") ?? ""), token: String(fd.get("token") ?? "") }, s.userId);
    revalidatePath("/settings/fhir");
    return { ok: true, message: "Saved. Test it, then sync." };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function testFhirAction(_prev: FormResult): Promise<FormResult> {
  const s = await admin();
  try {
    return { ok: true, message: `Connected: ${await testFhir(await getDb(), s.practiceId)}` };
  } catch (e) {
    return fail(e, "Could not reach the FHIR server");
  }
}

export async function syncFhirAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin", "biller"]);
  try {
    const r = await syncFhir(await getDb(), s.practiceId, { userId: s.userId });
    revalidatePath("/settings/fhir");
    revalidatePath("/billing/missed-charges");
    return { ok: true, message: `${r.patientsCreated} new patients, ${r.patientsUpdated} updated, ${r.visits} visits waiting for charges${r.skipped.length ? `; ${r.skipped.length} records skipped` : ""}` };
  } catch (e) {
    return fail(e, "Sync failed");
  }
}

export async function removeFhirAction(_prev: FormResult): Promise<FormResult> {
  const s = await admin();
  await removeFhir(await getDb(), s.practiceId, s.userId);
  revalidatePath("/settings/fhir");
  return { ok: true, message: "Disconnected" };
}
