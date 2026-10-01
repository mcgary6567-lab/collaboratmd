/**
 * Therapy plans of care and their certification, for Medicare outpatient
 * physical therapy, occupational therapy and speech-language pathology
 * (42 CFR 424.24(c) and the Medicare Benefit Policy Manual, chapter 15):
 *
 *  - Each discipline's services follow a written plan of care, which a
 *    physician or nonphysician practitioner certifies by signing it, as soon
 *    as possible and within 30 days of the initial treatment. A later
 *    signature is accepted with the reason for the delay.
 *  - A plan runs at most 90 days; to keep treating, it is recertified at
 *    least every 90 days.
 *
 * Medicare claims with GP, GO or GN lines are checked against the patient's
 * plans: none covering the visit, or one not certified in time, is flagged.
 */
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

const { therapyPlans, patients, auditLog } = schema;

export const DISCIPLINES = { pt: { label: "Physical therapy", modifier: "GP" }, ot: { label: "Occupational therapy", modifier: "GO" }, slp: { label: "Speech-language pathology", modifier: "GN" } } as const;
export type PlanDiscipline = keyof typeof DISCIPLINES;
export const MAX_PLAN_DAYS = 90;
export const CERTIFY_WITHIN_DAYS = 30;

const isDay = (v: string | undefined | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The discipline a line's therapy modifier names, if any. */
export function disciplineOfLine(modifiers: string[]): PlanDiscipline | null {
  const m = modifiers.map((x) => x.toUpperCase());
  return m.includes("GP") ? "pt" : m.includes("GO") ? "ot" : m.includes("GN") ? "slp" : null;
}

function checkCertification(startsOn: string, certifiedOn: string | null | undefined, delayReason: string | null | undefined, npi: string | null | undefined) {
  if (!certifiedOn) return;
  if (!isDay(certifiedOn)) throw new Error("Enter the date the plan was signed");
  if (certifiedOn < startsOn) throw new Error("The plan cannot be signed before it starts");
  if (days(startsOn, certifiedOn) > CERTIFY_WITHIN_DAYS && !delayReason?.trim()) throw new Error(`Signed more than ${CERTIFY_WITHIN_DAYS} days after the first treatment: Medicare accepts a late certification with the reason for the delay`);
  if (npi && !/^\d{10}$/.test(npi)) throw new Error("The certifying physician's NPI is 10 digits");
}

export async function savePlan(db: Db, practiceId: string, input: { patientId: string; discipline: string; startsOn: string; endsOn: string; certifiedOn?: string | null; certifierName?: string; certifierNpi?: string; delayReason?: string; previousPlanId?: string | null }, userId?: string) {
  const [p] = await db.select({ id: patients.id }).from(patients).where(and(eq(patients.id, input.patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!p) throw new Error("Patient not found");
  if (!(input.discipline in DISCIPLINES)) throw new Error("Choose physical, occupational or speech therapy");
  if (!isDay(input.startsOn) || !isDay(input.endsOn) || input.endsOn < input.startsOn) throw new Error("Enter the plan's first and last day");
  if (days(input.startsOn, input.endsOn) + 1 > MAX_PLAN_DAYS) throw new Error(`A plan of care runs at most ${MAX_PLAN_DAYS} days; recertify to continue`);
  checkCertification(input.startsOn, input.certifiedOn, input.delayReason, input.certifierNpi?.trim());
  const [row] = await db.insert(therapyPlans).values({
    practiceId, patientId: input.patientId, discipline: input.discipline, startsOn: input.startsOn, endsOn: input.endsOn,
    certifiedOn: input.certifiedOn || null, certifierName: input.certifierName?.trim().slice(0, 120) || null, certifierNpi: input.certifierNpi?.trim() || null,
    delayReason: input.delayReason?.trim().slice(0, 500) || null, previousPlanId: input.previousPlanId ?? null, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "therapy_plan_saved", entity: "patient", entityId: input.patientId, details: { planId: row.id, discipline: input.discipline, startsOn: input.startsOn, endsOn: input.endsOn, certified: !!input.certifiedOn } });
  return row;
}

/** Records the physician's signature on a plan. */
export async function certifyPlan(db: Db, practiceId: string, planId: string, input: { certifiedOn: string; certifierName: string; certifierNpi?: string; delayReason?: string }, userId?: string) {
  const [plan] = await db.select().from(therapyPlans).where(and(eq(therapyPlans.id, planId), eq(therapyPlans.practiceId, practiceId))).limit(1);
  if (!plan) throw new Error("Plan not found");
  if (!input.certifierName.trim()) throw new Error("Enter who signed the plan");
  checkCertification(plan.startsOn, input.certifiedOn, input.delayReason, input.certifierNpi?.trim());
  await db.update(therapyPlans).set({ certifiedOn: input.certifiedOn, certifierName: input.certifierName.trim().slice(0, 120), certifierNpi: input.certifierNpi?.trim() || null, delayReason: input.delayReason?.trim().slice(0, 500) || null }).where(eq(therapyPlans.id, planId));
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "therapy_plan_certified", entity: "patient", entityId: plan.patientId, details: { planId, certifiedOn: input.certifiedOn } });
}

/** Starts the next plan the day after this one ends (a recertification), for up to 90 days. */
export async function recertify(db: Db, practiceId: string, planId: string, endsOn: string, userId?: string) {
  const [plan] = await db.select().from(therapyPlans).where(and(eq(therapyPlans.id, planId), eq(therapyPlans.practiceId, practiceId))).limit(1);
  if (!plan) throw new Error("Plan not found");
  return savePlan(db, practiceId, { patientId: plan.patientId, discipline: plan.discipline, startsOn: addDays(plan.endsOn, 1), endsOn, previousPlanId: plan.id }, userId);
}

export async function plansFor(db: Db, patientId: string) {
  return db.select().from(therapyPlans).where(eq(therapyPlans.patientId, patientId)).orderBy(desc(therapyPlans.startsOn));
}

/** Scrub: Medicare therapy lines need a plan covering the visit, certified within 30 days (or late with a reason). */
export async function planOfCareFindings(db: Db, c: { patientId: string; payerType: string; dateOfService: string; lines: { lineNumber: number; modifiers: string[] }[] }): Promise<ScrubFinding[]> {
  if (c.payerType !== "medicare") return [];
  const wanted = new Map<PlanDiscipline, number>();
  for (const l of c.lines) {
    const d = disciplineOfLine(l.modifiers);
    if (d && !wanted.has(d)) wanted.set(d, l.lineNumber);
  }
  if (!wanted.size) return [];
  const out: ScrubFinding[] = [];
  for (const [d, line] of wanted) {
    const [plan] = await db.select().from(therapyPlans)
      .where(and(eq(therapyPlans.patientId, c.patientId), eq(therapyPlans.discipline, d), lte(therapyPlans.startsOn, c.dateOfService), gte(therapyPlans.endsOn, c.dateOfService)))
      .orderBy(desc(therapyPlans.startsOn)).limit(1);
    const label = DISCIPLINES[d].label.toLowerCase();
    if (!plan) {
      const [earlier] = await db.select().from(therapyPlans).where(and(eq(therapyPlans.patientId, c.patientId), eq(therapyPlans.discipline, d), lte(therapyPlans.endsOn, c.dateOfService))).orderBy(desc(therapyPlans.endsOn)).limit(1);
      out.push({ rule: "THERAPY_PLAN", severity: "warning", field: `lines.${line}.modifiers`, message: earlier
        ? `The ${label} plan of care ended ${earlier.endsOn}: Medicare needs it recertified to cover this visit. Record the recertification on the patient's page.`
        : `No ${label} plan of care on file covers this visit. Medicare pays outpatient therapy only under a plan certified by a physician or NPP; record it on the patient's page.` });
      continue;
    }
    if (!plan.certifiedOn && days(plan.startsOn, c.dateOfService) > CERTIFY_WITHIN_DAYS) {
      out.push({ rule: "THERAPY_CERTIFICATION", severity: "warning", field: `lines.${line}.modifiers`, message: `The ${label} plan of care that started ${plan.startsOn} is not signed, and it is past the ${CERTIFY_WITHIN_DAYS}-day window. Get the physician's signature (with the reason for the delay) before billing; Medicare denies uncertified therapy.` });
    }
  }
  return out;
}

/** Plans to act on: not yet certified, or ending within `soonDays` with no plan after them. */
export async function plansNeedingAction(db: Db, practiceId: string, soonDays = 14, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const soon = addDays(today, soonDays);
  const next = schema.therapyPlans;
  const rows = await db.select({ plan: therapyPlans, firstName: patients.firstName, lastName: patients.lastName, mrn: patients.mrn }).from(therapyPlans)
    .innerJoin(patients, eq(patients.id, therapyPlans.patientId))
    .where(and(eq(therapyPlans.practiceId, practiceId), gte(therapyPlans.endsOn, addDays(today, -30)),
      sql`NOT EXISTS (SELECT 1 FROM therapy_plans n WHERE n.previous_plan_id = ${next.id})`))
    .orderBy(asc(therapyPlans.endsOn)).limit(500);
  return rows.map((r) => ({
    ...r,
    uncertified: !r.plan.certifiedOn,
    daysSinceStart: days(r.plan.startsOn, today),
    certificationLate: !r.plan.certifiedOn && days(r.plan.startsOn, today) > CERTIFY_WITHIN_DAYS,
    endingSoon: r.plan.endsOn <= soon,
    ended: r.plan.endsOn < today,
  })).filter((r) => r.uncertified || r.endingSoon);
}

/** Uncertified plans count, for badges. */
export async function uncertifiedCount(db: Db, practiceId: string) {
  const rows = await db.select({ id: therapyPlans.id }).from(therapyPlans).where(and(eq(therapyPlans.practiceId, practiceId), isNull(therapyPlans.certifiedOn)));
  return rows.length;
}
