"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_ADJUST, CAN_WRITE, requireRole } from "@/lib/auth";
import { submitClaim, rescrubClaim, fetchAndPostRemittances, importRemittance, postRemittance, writeOffClaim, transferToPatient, getClaimFinancials } from "@/server/claims";
import { assertWriteOffAllowed } from "@/server/policies";
import { createPatient, runEligibility, postPatientPayment } from "@/server/patients";
import { createEncounterWithClaim, createAppointment, setAppointmentStatus } from "@/server/encounters";
import { updateDenialStatus } from "@/server/reports";
import { APPOINTMENT_STATUSES, DENIAL_STATUSES, assertOwned } from "@/server/tenancy";

export type ActionResult = { ok: boolean; message: string; id?: string };

function fail(err: unknown): ActionResult {
  return { ok: false, message: err instanceof Error ? err.message : "Something went wrong" };
}

/* ----------------------------- Claims ----------------------------- */

export async function submitClaimAction(claimId: string): Promise<ActionResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "claim", claimId);
    const { status, result } = await submitClaim(db, claimId, s.userId, { role: s.role });
    revalidatePath("/claims");
    revalidatePath(`/claims/${claimId}`);
    return { ok: status === "accepted", message: result.message };
  } catch (e) {
    revalidatePath(`/claims/${claimId}`);
    return fail(e);
  }
}

export async function rescrubClaimAction(claimId: string): Promise<ActionResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    await assertOwned(db, s.practiceId, "claim", claimId);
    const c = await rescrubClaim(db, claimId);
    revalidatePath(`/claims/${claimId}`);
    return { ok: c.status === "ready", message: c.status === "ready" ? "Claim passed scrubbing" : "Claim still has blocking errors" };
  } catch (e) {
    return fail(e);
  }
}

export async function submitAllReadyAction(): Promise<ActionResult> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  const { listClaims } = await import("@/server/claims");
  const ready = await listClaims(db, s.practiceId, "ready");
  let accepted = 0;
  let rejected = 0;
  for (const r of ready) {
    try {
      const { status } = await submitClaim(db, r.claim.id, s.userId, { role: s.role });
      if (status === "accepted") accepted++;
      else rejected++;
    } catch {
      rejected++;
    }
  }
  revalidatePath("/claims");
  return { ok: true, message: `Submitted ${ready.length} claims: ${accepted} accepted, ${rejected} rejected` };
}

export async function writeOffClaimAction(claimId: string, formData: FormData): Promise<void> {
  const s = await requireRole(CAN_ADJUST);
  const db = await getDb();
  await assertOwned(db, s.practiceId, "claim", claimId);
  await assertWriteOffAllowed(db, s.practiceId, s.role, (await getClaimFinancials(db, claimId)).insuranceBalanceCents);
  await writeOffClaim(db, claimId, String(formData.get("reason") || "Write-off"), s.userId);
  revalidatePath(`/claims/${claimId}`);
  revalidatePath("/denials");
}

export async function transferToPatientAction(claimId: string): Promise<void> {
  const s = await requireRole(CAN_ADJUST);
  const db = await getDb();
  await assertOwned(db, s.practiceId, "claim", claimId);
  await transferToPatient(db, claimId, s.userId);
  revalidatePath(`/claims/${claimId}`);
}

/* --------------------------- Remittance --------------------------- */

export async function fetchRemittancesAction(): Promise<ActionResult> {
  const s = await requireRole(CAN_ADJUST);
  try {
    const db = await getDb();
    const n = await fetchAndPostRemittances(db, s.practiceId, s.userId);
    revalidatePath("/remittance");
    revalidatePath("/claims");
    revalidatePath("/denials");
    revalidatePath("/dashboard");
    return { ok: true, message: n ? `Received and auto-posted ${n} ERA file(s)` : "No new remittances available for accepted claims" };
  } catch (e) {
    return fail(e);
  }
}

export async function import835Action(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const s = await requireRole(CAN_ADJUST);
  const raw = String(formData.get("raw") ?? "").trim();
  if (!raw.startsWith("ISA")) return { ok: false, message: "Paste a full X12 835 file starting with an ISA segment" };
  try {
    const db = await getDb();
    const id = await importRemittance(db, s.practiceId, raw, s.userId);
    const summary = (await postRemittance(db, id, s.userId)) as { matched: number; unmatched: string[] };
    revalidatePath("/remittance");
    revalidatePath("/claims");
    return { ok: true, message: `Imported: ${summary.matched} claims matched${summary.unmatched.length ? `, unmatched: ${summary.unmatched.join(", ")}` : ""}`, id };
  } catch (e) {
    return fail(e);
  }
}

/* ----------------------------- Denials ---------------------------- */

export async function denialStatusAction(id: string, status: string): Promise<void> {
  const s = await requireRole(CAN_ADJUST);
  if (!(DENIAL_STATUSES as readonly string[]).includes(status)) throw new Error("Unknown denial status");
  const db = await getDb();
  await assertOwned(db, s.practiceId, "denial", id);
  await updateDenialStatus(db, id, status);
  revalidatePath("/denials");
}

/* ----------------------------- Patients --------------------------- */

const patientSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string().min(8),
  sex: z.enum(["M", "F", "U"]),
  phone: z.string().optional(),
  email: z.string().optional(),
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  payerId: z.string().uuid(),
  memberId: z.string().min(1),
  groupNumber: z.string().optional(),
  relationship: z.enum(["self", "spouse", "child", "other"]),
  copayCents: z.coerce.number().int().min(0),
});

export async function createPatientAction(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const s = await requireRole(CAN_WRITE);
  const data = Object.fromEntries(formData.entries());
  const parsed = patientSchema.safeParse({ ...data, copayCents: Math.round(parseFloat(String(data.copay || "0")) * 100) });
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const db = await getDb();
  try {
    await assertOwned(db, s.practiceId, "payer", parsed.data.payerId);
  } catch (e) {
    return fail(e);
  }
  const p = await createPatient(db, s.practiceId, parsed.data);
  revalidatePath("/patients");
  redirect(`/patients/${p.id}`);
}

export async function eligibilityAction(patientInsuranceId: string, patientId: string): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  const [own] = await db
    .select({ id: schema.patientInsurances.id })
    .from(schema.patientInsurances)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
    .where(and(eq(schema.patientInsurances.id, patientInsuranceId), eq(schema.patients.id, patientId), eq(schema.patients.practiceId, s.practiceId)))
    .limit(1);
  if (!own) throw new Error("Insurance not found");
  await runEligibility(db, patientInsuranceId);
  revalidatePath(`/patients/${patientId}`);
}

export async function patientPaymentAction(patientId: string, formData: FormData): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const cents = Math.round(parseFloat(String(formData.get("amount") || "0")) * 100);
  if (cents <= 0) return;
  const db = await getDb();
  await assertOwned(db, s.practiceId, "patient", patientId);
  await postPatientPayment(db, s.practiceId, patientId, cents, String(formData.get("method") || "card"), s.userId);
  revalidatePath(`/patients/${patientId}`);
}

/* ---------------------------- Scheduling -------------------------- */

export async function createAppointmentAction(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const s = await requireRole(CAN_WRITE);
  const startsAt = new Date(String(formData.get("startsAt")));
  if (Number.isNaN(startsAt.getTime())) return { ok: false, message: "Invalid start time" };
  const db = await getDb();
  const patientId = String(formData.get("patientId"));
  const providerId = String(formData.get("providerId"));
  try {
    await assertOwned(db, s.practiceId, "patient", patientId);
    await assertOwned(db, s.practiceId, "provider", providerId);
  } catch (e) {
    return fail(e);
  }
  await createAppointment(db, s.practiceId, {
    patientId,
    providerId,
    startsAt,
    minutes: Number(formData.get("minutes") || 30),
    type: String(formData.get("type") || "office_visit"),
    reason: String(formData.get("reason") || ""),
  });
  revalidatePath("/scheduling");
  return { ok: true, message: "Appointment booked" };
}

export async function appointmentStatusAction(id: string, status: string): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  if (!(APPOINTMENT_STATUSES as readonly string[]).includes(status)) throw new Error("Unknown appointment status");
  const db = await getDb();
  await assertOwned(db, s.practiceId, "appointment", id);
  await setAppointmentStatus(db, id, status);
  revalidatePath("/scheduling");
}

/* --------------------------- Charge entry ------------------------- */

const encounterSchema = z.object({
  patientId: z.string().uuid(),
  providerId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable().optional(),
  dateOfService: z.string().min(8),
  placeOfService: z.string().min(2),
  diagnoses: z.array(z.string().min(3)).min(1).max(12),
  lines: z
    .array(
      z.object({
        cpt: z.string().min(5),
        modifiers: z.array(z.string()),
        units: z.number().int().min(1),
        chargeCents: z.number().int().min(1),
        dxPointers: z.array(z.number().int().min(1)).min(1),
        description: z.string().optional(),
      }),
    )
    .min(1)
    .max(50),
});

export async function createEncounterAction(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const s = await requireRole(CAN_WRITE);
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get("payload")));
  } catch {
    return { ok: false, message: "Invalid form payload" };
  }
  const parsed = encounterSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  const db = await getDb();
  try {
    await assertOwned(db, s.practiceId, "patient", parsed.data.patientId);
    await assertOwned(db, s.practiceId, "provider", parsed.data.providerId);
    if (parsed.data.appointmentId) await assertOwned(db, s.practiceId, "appointment", parsed.data.appointmentId);
  } catch (e) {
    return fail(e);
  }
  const { claim } = await createEncounterWithClaim(db, s.practiceId, parsed.data, s.userId);
  revalidatePath("/claims");
  redirect(`/claims/${claim.id}`);
}
