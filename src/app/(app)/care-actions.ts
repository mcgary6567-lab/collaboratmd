"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assertOwned } from "@/server/tenancy";
import { billCareMonth, logCareMinutes, recordCareConsent } from "@/server/care-programs";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function careConsentAction(patientId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "patient", patientId);
    await recordCareConsent(db, s.practiceId, patientId, f(fd, "program"), f(fd, "consentedOn"), s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: "Consent recorded" };
  } catch (e) {
    return fail(e);
  }
}

export async function logCareMinutesAction(patientId: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "patient", patientId);
    await logCareMinutes(db, s.practiceId, { patientId, providerId: f(fd, "providerId"), program: f(fd, "program"), performedOn: f(fd, "performedOn"), minutes: Number(f(fd, "minutes")), note: f(fd, "note") }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: "Time logged" };
  } catch (e) {
    return fail(e);
  }
}

export async function billCareMonthAction(patientId: string, program: string, month: string, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "patient", patientId);
    const r = await billCareMonth(db, s.practiceId, { patientId, program, month, diagnoses: f(fd, "diagnoses").split(/[,\s]+/) }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: `Claim created for ${r.minutes} minutes: ${r.lines.map((l) => `${l.code} x${l.units}`).join(", ")}` };
  } catch (e) {
    return fail(e);
  }
}
