"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@/db";
import { requireSession } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { createClaimForEncounter, createCorrectedClaim, voidClaim } from "@/server/claims";
import { cancelAuthorization, createAuthorization, createPayerEdit, setPayerEditActive } from "@/server/payer-edits";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const list = (v: FormDataEntryValue | null) => String(v ?? "").split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);

/** Loads a claim only if it belongs to the signed-in practice. */
async function ownClaim(db: Db, practiceId: string, claimId: string) {
  const [claim] = await db.select().from(schema.claims).where(and(eq(schema.claims.id, claimId), eq(schema.claims.practiceId, practiceId))).limit(1);
  if (!claim) throw new Error("Claim not found");
  return claim;
}

/* ---------------------- Corrections and voids ---------------------- */

export async function correctClaimAction(claimId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireSession();
  let createdId: string;
  try {
    const db = await getDb();
    await ownClaim(db, s.practiceId, claimId);
    createdId = (await createCorrectedClaim(db, claimId, s.userId)).id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/claims");
  revalidatePath("/denials");
  redirect(`/claims/${createdId}`);
}

export async function voidClaimAction(claimId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireSession();
  let createdId: string;
  try {
    const db = await getDb();
    await ownClaim(db, s.practiceId, claimId);
    createdId = (await voidClaim(db, claimId, String(formData.get("reason") ?? ""), s.userId)).id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/claims");
  revalidatePath(`/claims/${claimId}`);
  redirect(`/claims/${createdId}`);
}

/** After a void, bills the same encounter again as a new original claim. */
export async function billAgainAction(claimId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireSession();
  let createdId: string;
  try {
    const db = await getDb();
    const claim = await ownClaim(db, s.practiceId, claimId);
    if (claim.status !== "voided") throw new Error("Only a voided claim can be billed again");
    createdId = (await createClaimForEncounter(db, claim.encounterId, s.userId)).id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/claims");
  redirect(`/claims/${createdId}`);
}

/* ----------------------------- Payer edits ----------------------------- */

export async function createPayerEditAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireSession();
  try {
    if (s.role !== "admin") throw new Error("Only an administrator can change payer edits");
    const db = await getDb();
    await createPayerEdit(db, s.practiceId, {
      payerId: String(formData.get("payerId") ?? "") || null,
      kind: String(formData.get("kind") ?? ""),
      cpt: String(formData.get("cpt") ?? "") || null,
      modifiers: list(formData.get("modifiers")),
      dxPrefixes: list(formData.get("dxPrefixes")),
      maxUnits: Number(formData.get("maxUnits") ?? 0) || null,
      severity: formData.get("severity") === "warning" ? "warning" : "error",
      message: String(formData.get("message") ?? ""),
    });
    revalidatePath("/settings/payer-edits");
    return { ok: true, message: "Edit added. It applies the next time a claim is scrubbed." };
  } catch (e) {
    return fail(e);
  }
}

export async function setPayerEditActiveAction(id: string, active: boolean): Promise<void> {
  const s = await requireSession();
  if (s.role !== "admin") throw new Error("Only an administrator can change payer edits");
  const db = await getDb();
  await setPayerEditActive(db, s.practiceId, id, active);
  revalidatePath("/settings/payer-edits");
}

/* ---------------------------- Authorizations ---------------------------- */

export async function createAuthorizationAction(patientId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireSession();
  try {
    const db = await getDb();
    const payerId = String(formData.get("payerId") ?? "");
    const [payer] = await db.select({ id: schema.payers.id }).from(schema.payers).where(and(eq(schema.payers.id, payerId), eq(schema.payers.practiceId, s.practiceId))).limit(1);
    if (!payer) throw new Error("Choose the payer that issued the authorization");
    const units = Number(formData.get("unitsApproved") ?? 0);
    await createAuthorization(db, s.practiceId, {
      patientId, payerId,
      authNumber: String(formData.get("authNumber") ?? ""),
      cpts: list(formData.get("cpts")),
      unitsApproved: units > 0 ? units : null,
      validFrom: String(formData.get("validFrom") ?? ""),
      validTo: String(formData.get("validTo") ?? ""),
      note: String(formData.get("note") ?? ""),
    });
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: "Authorization saved" };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelAuthorizationAction(patientId: string, id: string): Promise<void> {
  const s = await requireSession();
  const db = await getDb();
  await cancelAuthorization(db, s.practiceId, id);
  revalidatePath(`/patients/${patientId}`);
}
