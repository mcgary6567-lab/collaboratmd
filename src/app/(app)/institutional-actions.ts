"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { assertOwned } from "@/server/tenancy";
import { createInstitutionalClaim } from "@/server/institutional";
import { chargemasterPrice } from "@/server/chargemaster";

export async function createInstitutionalAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const f = (k: string) => String(formData.get(k) ?? "").trim();
  const revenue = formData.getAll("rev").map(String);
  const hcpcs = formData.getAll("hcpcs").map(String);
  const units = formData.getAll("units").map(String);
  const unitCharge = formData.getAll("charge").map(String);
  let claimId: string;
  try {
    const db = await getDb();
    const patientId = f("patientId");
    if (!patientId) return { ok: false, message: "Choose the patient" };
    await assertOwned(db, s.practiceId, "patient", patientId);
    const entered = revenue.map((r, i) => ({ revenueCode: r, hcpcs: hcpcs[i], units: Number(units[i]) || 1, chargeCents: Math.round(Number(String(unitCharge[i] ?? "").replace(/[$,]/g, "")) * 100) || 0 })).filter((l) => l.revenueCode.trim());
    // A line left without a charge is priced from the chargemaster.
    const lines = await Promise.all(entered.map(async (l) => (l.chargeCents ? l : { ...l, chargeCents: (await chargemasterPrice(db, s.practiceId, l.revenueCode, l.hcpcs || null)) ?? 0 })));
    const claim = await createInstitutionalClaim(db, s.practiceId, {
      patientId,
      attendingProviderId: f("attending"),
      typeOfBill: f("tob"),
      statementFrom: f("from"),
      statementTo: f("to") || f("from"),
      admissionDate: f("admitDate") || null,
      admissionHour: f("admitHour") || null,
      admissionType: f("admitType") || null,
      admissionSource: f("admitSource") || null,
      patientStatus: f("status"),
      admittingDiagnosis: f("admitDx") || null,
      procedures: formData.getAll("pcs").map((code, i) => ({ code: String(code), date: String(formData.getAll("pcsDate")[i] ?? "") })),
      diagnoses: f("diagnoses").split(/[,\s]+/),
      lines,
    }, s.userId);
    claimId = claim.id;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not create the claim" };
  }
  redirect(`/claims/${claimId}`);
}
