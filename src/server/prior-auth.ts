/**
 * Electronic prior authorization: builds a 278 for the patient's insurance,
 * sends it through the practice's clearinghouse, and records the answer.
 * An approval becomes an authorization on file (the one the scrubber and
 * claims already use); a pended request becomes a follow-up task.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";
import { build278, parse278Response } from "@/lib/edi/x278";
import { practiceConfig } from "./integrations";
import { createAuthorization } from "./payer-edits";
import { createTask } from "./work";

const { authRequests, patients, patientInsurances, payers, providers, practices, auditLog } = schema;

export type PriorAuthInput = { patientId: string; providerId: string; cpts: string[]; diagnoses: string[]; units: number; serviceFrom: string; serviceTo: string; placeOfService?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function requestPriorAuth(db: Db, practiceId: string, input: PriorAuthInput, userId?: string) {
  const cpts = [...new Set(input.cpts.map((c) => c.trim().toUpperCase()).filter((c) => /^[0-9A-Z]{5}$/.test(c)))];
  const diagnoses = input.diagnoses.map((d) => d.trim().toUpperCase()).filter(Boolean).slice(0, 12);
  if (!cpts.length) throw new Error("List the procedure codes to authorize (5-character CPT or HCPCS)");
  if (!diagnoses.length) throw new Error("List at least one diagnosis code");
  if (!DATE.test(input.serviceFrom) || !DATE.test(input.serviceTo) || input.serviceTo < input.serviceFrom) throw new Error("Enter the planned service dates");
  const units = Math.max(1, Math.min(999, Math.round(input.units) || 1));

  const [row] = await db
    .select({ patient: patients, ins: patientInsurances, payer: payers, practice: practices })
    .from(patients)
    .innerJoin(patientInsurances, and(eq(patientInsurances.patientId, patients.id), eq(patientInsurances.active, true)))
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .innerJoin(practices, eq(practices.id, patients.practiceId))
    .where(and(eq(patients.id, input.patientId), eq(patients.practiceId, practiceId)))
    .orderBy(asc(patientInsurances.rank))
    .limit(1);
  if (!row) throw new Error("The patient needs active insurance first");
  const [provider] = await db.select().from(providers).where(and(eq(providers.id, input.providerId), eq(providers.practiceId, practiceId))).limit(1);
  if (!provider) throw new Error("Provider not found");

  const now = new Date();
  const trace = `PA${now.getTime().toString(36).toUpperCase()}`;
  const edi = build278({
    senderId: "COLLABORATMD", receiverId: row.payer.payerId, now, control: String(now.getTime() % 1_000_000_000),
    payer: { name: row.payer.name, payerId: row.payer.payerId },
    requester: { name: row.practice.name, npi: provider.npi, lastName: provider.lastName, firstName: provider.firstName },
    subscriber: { lastName: row.patient.lastName, firstName: row.patient.firstName, memberId: row.ins.memberId, dob: row.patient.dob, sex: row.patient.sex },
    event: { serviceFrom: input.serviceFrom, serviceTo: input.serviceTo, placeOfService: input.placeOfService || "11", diagnoses, trace },
    services: cpts.map((cpt) => ({ cpt, units: Math.max(1, Math.round(units / cpts.length)) })),
  });

  let raw: string | null = null;
  let parsed: ReturnType<typeof parse278Response>;
  try {
    raw = await getClearinghouse((await practiceConfig(db, practiceId)).stedi?.apiKey).requestAuthorization(edi);
    parsed = parse278Response(raw);
  } catch (e) {
    parsed = { status: "error", action: null, actionLabel: e instanceof Error ? e.message : "The clearinghouse did not answer", authNumber: null, validFrom: null, validTo: null, units: null, errors: [], services: [] };
  }

  let authorizationId: string | null = null;
  if ((parsed.status === "approved" || parsed.status === "partial") && parsed.authNumber) {
    const auth = await createAuthorization(db, practiceId, {
      patientId: row.patient.id, payerId: row.payer.id, authNumber: parsed.authNumber, cpts,
      unitsApproved: parsed.units ?? units, validFrom: parsed.validFrom ?? input.serviceFrom, validTo: parsed.validTo ?? input.serviceTo,
      note: `Approved electronically (278, ${parsed.actionLabel.toLowerCase()})`,
    });
    authorizationId = auth.id;
  }
  if (parsed.status === "pended") {
    await createTask(db, practiceId, {
      title: `Follow up prior authorization with ${row.payer.name}`,
      entityType: "patient", entityId: row.patient.id, priority: "high",
      note: `${cpts.join(", ")} for ${input.serviceFrom}: the payer pended the request${parsed.authNumber ? ` (reference ${parsed.authNumber})` : ""}. Send any clinical notes they ask for, then record the authorization number when it is approved.`,
    }, userId);
  }

  const [saved] = await db
    .insert(authRequests)
    .values({
      practiceId, patientId: row.patient.id, payerId: row.payer.id, providerId: provider.id, cpts, diagnoses, units,
      serviceFrom: input.serviceFrom, serviceTo: input.serviceTo, status: parsed.status, authNumber: parsed.authNumber,
      validFrom: parsed.validFrom, validTo: parsed.validTo, message: parsed.errors.length ? parsed.errors.join("; ") : parsed.actionLabel,
      authorizationId, request278: edi, response278: raw, createdBy: userId ?? null,
    })
    .returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "prior_auth_requested", entity: "patient", entityId: row.patient.id, details: { status: parsed.status, cpts } });
  return saved;
}

export async function listAuthRequests(db: Db, practiceId: string, patientId: string) {
  return db
    .select({ req: authRequests, payerName: payers.name })
    .from(authRequests)
    .innerJoin(payers, eq(payers.id, authRequests.payerId))
    .where(and(eq(authRequests.practiceId, practiceId), eq(authRequests.patientId, patientId)))
    .orderBy(desc(authRequests.createdAt))
    .limit(20);
}
