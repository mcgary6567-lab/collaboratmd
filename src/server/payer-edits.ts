import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { EDIT_KINDS, type AuthOnFile, type PayerEditRule } from "@/lib/scrub/payer-edits";

const { payerEdits, authorizations, payers, patients } = schema;

/* ------------------------------------------------------------------ */
/* Payer edits                                                          */
/* ------------------------------------------------------------------ */

export async function listPayerEdits(db: Db, practiceId: string) {
  return db
    .select({ edit: payerEdits, payerName: payers.name })
    .from(payerEdits)
    .leftJoin(payers, eq(payers.id, payerEdits.payerId))
    .where(eq(payerEdits.practiceId, practiceId))
    .orderBy(asc(payers.name), asc(payerEdits.cpt));
}

/** Active rules for a payer, including rules that apply to every payer. */
export async function rulesForPayer(db: Db, practiceId: string, payerId: string): Promise<PayerEditRule[]> {
  const rows = await db
    .select()
    .from(payerEdits)
    .where(and(eq(payerEdits.practiceId, practiceId), eq(payerEdits.active, true), or(eq(payerEdits.payerId, payerId), isNull(payerEdits.payerId))));
  return rows.map((r) => ({ id: r.id, kind: r.kind, cpt: r.cpt, params: r.params, severity: r.severity, message: r.message }));
}

export interface NewEditInput {
  payerId: string | null;
  kind: string;
  cpt: string | null;
  modifiers?: string[];
  dxPrefixes?: string[];
  maxUnits?: number | null;
  severity: "error" | "warning";
  message?: string;
}

const DEFAULT_MESSAGES: Record<string, string> = {
  auth_required: "Prior authorization is required and none on file covers this date of service",
  modifier_required: "This payer requires a modifier on this code",
  dx_required: "This payer requires a qualifying diagnosis for this code",
  max_units: "Units exceed this payer's limit for one line",
  not_covered: "This payer does not cover this code",
};

export async function createPayerEdit(db: Db, practiceId: string, input: NewEditInput) {
  if (!EDIT_KINDS.some((k) => k.kind === input.kind)) throw new Error("Unknown edit type");
  const cpt = input.cpt?.trim().toUpperCase() || null;
  if (input.kind !== "dx_required" && !cpt) throw new Error("This edit needs a procedure code");
  if (input.payerId) {
    const [p] = await db.select({ id: payers.id }).from(payers).where(and(eq(payers.id, input.payerId), eq(payers.practiceId, practiceId))).limit(1);
    if (!p) throw new Error("Payer not found");
  }
  const params: { modifiers?: string[]; dxPrefixes?: string[]; maxUnits?: number } = {};
  if (input.kind === "modifier_required") {
    params.modifiers = (input.modifiers ?? []).map((m) => m.trim().toUpperCase()).filter(Boolean);
    if (!params.modifiers.length) throw new Error("List at least one modifier");
  }
  if (input.kind === "dx_required") {
    params.dxPrefixes = (input.dxPrefixes ?? []).map((d) => d.trim().toUpperCase()).filter(Boolean);
    if (!params.dxPrefixes.length) throw new Error("List at least one diagnosis code or prefix");
  }
  if (input.kind === "max_units") {
    if (!input.maxUnits || input.maxUnits < 1) throw new Error("Set a unit limit of at least 1");
    params.maxUnits = input.maxUnits;
  }
  const [row] = await db
    .insert(payerEdits)
    .values({
      practiceId, payerId: input.payerId, kind: input.kind, cpt, params,
      severity: input.severity === "warning" ? "warning" : "error",
      message: input.message?.trim() || DEFAULT_MESSAGES[input.kind],
    })
    .returning();
  return row;
}

export async function setPayerEditActive(db: Db, practiceId: string, id: string, active: boolean) {
  await db.update(payerEdits).set({ active }).where(and(eq(payerEdits.id, id), eq(payerEdits.practiceId, practiceId)));
}

/* ------------------------------------------------------------------ */
/* Authorizations                                                       */
/* ------------------------------------------------------------------ */

export async function authsForPatient(db: Db, practiceId: string, patientId: string, payerId?: string): Promise<AuthOnFile[]> {
  const rows = await db
    .select()
    .from(authorizations)
    .where(
      and(
        eq(authorizations.practiceId, practiceId),
        eq(authorizations.patientId, patientId),
        ...(payerId ? [eq(authorizations.payerId, payerId)] : []),
      ),
    )
    .orderBy(desc(authorizations.validTo));
  return rows.map((a) => ({
    id: a.id, authNumber: a.authNumber, cpts: a.cpts, unitsApproved: a.unitsApproved, unitsUsed: a.unitsUsed,
    validFrom: a.validFrom, validTo: a.validTo, status: a.status,
  }));
}

export async function listPatientAuthorizations(db: Db, practiceId: string, patientId: string) {
  return db
    .select({ auth: authorizations, payerName: payers.name })
    .from(authorizations)
    .innerJoin(payers, eq(payers.id, authorizations.payerId))
    .where(and(eq(authorizations.practiceId, practiceId), eq(authorizations.patientId, patientId)))
    .orderBy(desc(authorizations.validTo));
}

export interface NewAuthInput {
  patientId: string;
  payerId: string;
  authNumber: string;
  cpts: string[];
  unitsApproved: number | null;
  validFrom: string;
  validTo: string;
  note?: string;
}

export async function createAuthorization(db: Db, practiceId: string, input: NewAuthInput) {
  if (!input.authNumber.trim()) throw new Error("Enter the authorization number from the payer");
  const cpts = input.cpts.map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (!cpts.length) throw new Error("List the procedure codes the authorization covers");
  if (!input.validFrom || !input.validTo || input.validTo < input.validFrom) throw new Error("The authorization dates are not valid");
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  const [row] = await db
    .insert(authorizations)
    .values({
      practiceId, patientId: input.patientId, payerId: input.payerId, authNumber: input.authNumber.trim(), cpts,
      unitsApproved: input.unitsApproved, validFrom: input.validFrom, validTo: input.validTo, note: input.note || null,
    })
    .returning();
  return row;
}

export async function cancelAuthorization(db: Db, practiceId: string, id: string) {
  await db.update(authorizations).set({ status: "cancelled" }).where(and(eq(authorizations.id, id), eq(authorizations.practiceId, practiceId)));
}

/** Draws units against an authorization once a claim that used it is accepted. */
export async function consumeAuthorization(db: Db, authId: string, units: number) {
  if (units <= 0) return;
  await db.update(authorizations).set({ unitsUsed: sql`${authorizations.unitsUsed} + ${units}` }).where(eq(authorizations.id, authId));
}
