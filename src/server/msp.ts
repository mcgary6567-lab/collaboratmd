/**
 * Medicare Secondary Payer (MSP): the questions that decide whether Medicare
 * or another plan pays first, and the checks that keep claims in that order.
 *
 * When another plan must pay first, a claim billed to Medicare as primary is
 * denied, and a Medicare claim as secondary has to say why Medicare is second
 * (SBR05, the MSP type). The questions follow CMS's MSP questionnaire, in the
 * order CMS resolves them.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

const { mspScreenings, patientInsurances, payers, auditLog } = schema;

export const MSP_QUESTIONS = [
  { key: "workersComp", type: "15", text: "Is this visit for a work-related injury or illness (workers' compensation)?" },
  { key: "noFault", type: "14", text: "Is it for an injury from an accident covered by auto or no-fault insurance?" },
  { key: "liability", type: "47", text: "Is someone else (a liability insurer) responsible for the injury?" },
  { key: "blackLung", type: "41", text: "Does the patient get Black Lung benefits, and is this visit for a lung condition from coal mining?" },
  { key: "va", type: "42", text: "Did the Department of Veterans Affairs authorize and agree to pay for this care?" },
  { key: "esrd", type: "13", text: "Is the patient on Medicare because of kidney failure (ESRD), within the first 30 months, and also covered by a group health plan?" },
  { key: "workingAged", type: "12", text: "Is the patient 65 or older and covered by a group health plan through their own or a spouse's current job at an employer with 20 or more employees?" },
  { key: "disability", type: "43", text: "Is the patient under 65, on Medicare because of a disability, and covered by a group health plan through their own or a family member's current job at an employer with 100 or more employees?" },
] as const;

export const MSP_TYPE_LABEL: Record<string, string> = {
  "12": "working aged, employer group health plan", "13": "end-stage renal disease coordination period", "14": "no-fault or auto insurance",
  "15": "workers' compensation", "16": "public health service or other federal agency", "41": "Black Lung", "42": "Veterans Affairs",
  "43": "disability, large group health plan", "47": "liability insurance",
};

/** Who pays first from the answers: the first "yes" in CMS's order makes Medicare secondary for that reason. */
export function mspResult(answers: Record<string, boolean>) {
  const hit = MSP_QUESTIONS.find((q) => answers[q.key]);
  return hit ? { medicarePrimary: false, mspType: hit.type as string } : { medicarePrimary: true, mspType: null };
}

/** Records the answers and, when Medicare pays second, marks the patient's Medicare coverage with the reason. */
export async function recordMspScreening(db: Db, practiceId: string, patientId: string, answers: Record<string, boolean>, userId?: string) {
  const clean = Object.fromEntries(MSP_QUESTIONS.map((q) => [q.key, !!answers[q.key]]));
  const result = mspResult(clean);
  const [row] = await db.insert(mspScreenings).values({ practiceId, patientId, answers: clean, medicarePrimary: result.medicarePrimary, mspType: result.mspType, screenedBy: userId ?? null }).returning();
  const medicare = await db.select({ id: patientInsurances.id }).from(patientInsurances).innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.patientId, patientId), eq(patientInsurances.active, true), eq(payers.type, "medicare"), eq(payers.practiceId, practiceId)));
  for (const m of medicare) await db.update(patientInsurances).set({ mspType: result.mspType }).where(eq(patientInsurances.id, m.id));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "msp_screening", entity: "patient", entityId: patientId, details: { medicarePrimary: result.medicarePrimary, mspType: result.mspType } });
  return row;
}

export async function latestMspScreening(db: Db, patientId: string) {
  const [row] = await db.select().from(mspScreenings).where(eq(mspScreenings.patientId, patientId)).orderBy(desc(mspScreenings.screenedAt)).limit(1);
  return row ?? null;
}

/** Whether a patient has Medicare and another active plan: the case the questions matter for. */
export async function needsMspScreening(db: Db, patientId: string) {
  const [r] = await db.select({ medicare: sql<number>`count(*) FILTER (WHERE ${payers.type} = 'medicare')::int`, other: sql<number>`count(*) FILTER (WHERE ${payers.type} NOT IN ('medicare', 'self_pay'))::int` })
    .from(patientInsurances).innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.patientId, patientId), eq(patientInsurances.active, true)));
  return Number(r?.medicare) > 0 && Number(r?.other) > 0;
}

const YEAR = 365 * 86_400_000;

/** Claim checks: Medicare billed first when it should be second, a Medicare-secondary claim with no reason, and questions not asked. */
export async function mspFindings(db: Db, c: { patientId: string; payerType: string; payerSequence: string; mspType: string | null; today?: Date }): Promise<ScrubFinding[]> {
  if (c.payerType !== "medicare") return [];
  const out: ScrubFinding[] = [];
  const screening = await latestMspScreening(db, c.patientId);
  if (c.payerSequence === "P" && screening && !screening.medicarePrimary) {
    out.push({ rule: "MSP_ORDER", severity: "error", field: "insurance", message: `Medicare pays second for this patient (${MSP_TYPE_LABEL[screening.mspType ?? ""] ?? "MSP"}): bill the other plan first, then Medicare as secondary` });
  }
  if (c.payerSequence === "S" && !c.mspType) {
    out.push({ rule: "MSP_TYPE", severity: "error", field: "insurance.mspType", message: "A claim to Medicare as the secondary payer needs the reason Medicare is second (the MSP type): answer the Medicare Secondary Payer questions on the patient's page" });
  }
  if (!screening || (c.today ?? new Date()).getTime() - screening.screenedAt.getTime() > YEAR) {
    if (await needsMspScreening(db, c.patientId)) out.push({ rule: "MSP_SCREENING", severity: "warning", field: "insurance", message: "This patient has Medicare and another plan: ask the Medicare Secondary Payer questions (patient's page) to confirm which pays first" });
  }
  return out;
}
