import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";
import { build270, summarize271, type EligibilitySummary } from "@/lib/edi/x270";
import { listAppointments } from "./encounters";
import { practiceConfig } from "./integrations";
import { emit } from "./webhooks";

const { patients, patientInsurances, payers, eligibilityChecks, encounters, ledgerEntries } = schema;

export async function searchPatients(db: Db, practiceId: string, q?: string) {
  const term = q?.trim();
  const where = term
    ? and(eq(patients.practiceId, practiceId), or(ilike(patients.lastName, `%${term}%`), ilike(patients.firstName, `%${term}%`), ilike(patients.mrn, `%${term}%`)))
    : eq(patients.practiceId, practiceId);
  return db.select().from(patients).where(where).orderBy(asc(patients.lastName), asc(patients.firstName)).limit(100);
}

export async function getPatient(db: Db, practiceId: string, id: string) {
  const [patient] = await db.select().from(patients).where(and(eq(patients.id, id), eq(patients.practiceId, practiceId))).limit(1);
  if (!patient) return null;
  const insurances = await db
    .select({ insurance: patientInsurances, payer: payers })
    .from(patientInsurances)
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(eq(patientInsurances.patientId, id))
    .orderBy(asc(patientInsurances.rank));
  const checks = await db
    .select()
    .from(eligibilityChecks)
    .where(sql`${eligibilityChecks.patientInsuranceId} IN (SELECT id FROM patient_insurances WHERE patient_id = ${id})`)
    .orderBy(desc(eligibilityChecks.checkedAt))
    .limit(5);
  const visits = await db.select().from(encounters).where(eq(encounters.patientId, id)).orderBy(desc(encounters.dateOfService));
  const ledger = await db.select().from(ledgerEntries).where(eq(ledgerEntries.patientId, id)).orderBy(desc(ledgerEntries.postedAt)).limit(50);
  return { patient, insurances, checks, visits, ledger };
}

export interface NewPatientInput {
  firstName: string;
  lastName: string;
  dob: string;
  sex: string;
  phone?: string;
  email?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  payerId: string;
  memberId: string;
  groupNumber?: string;
  relationship: string;
  copayCents: number;
}

export async function createPatient(db: Db, practiceId: string, input: NewPatientInput) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(patients).where(eq(patients.practiceId, practiceId));
  const [p] = await db
    .insert(patients)
    .values({
      practiceId,
      mrn: "P" + String(Number(n) + 1001).padStart(5, "0"),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      dob: input.dob,
      sex: input.sex,
      phone: input.phone || null,
      email: input.email || null,
      address1: input.address1 || null,
      city: input.city || null,
      state: input.state || null,
      zip: input.zip || null,
    })
    .returning();
  await db.insert(patientInsurances).values({ patientId: p.id, payerId: input.payerId, memberId: input.memberId.trim(), groupNumber: input.groupNumber || null, rank: 1, relationship: input.relationship, copayCents: input.copayCents });
  await emit(db, practiceId, "patient.created", { patient_id: p.id, mrn: p.mrn, source: "staff" });
  return p;
}

/**
 * Asks the payer about coverage with a real 270 and records its 271: the raw
 * transactions, and the individual in-network figures the front desk and the
 * estimator use.
 */
export async function runEligibility(db: Db, patientInsuranceId: string, serviceDate?: string) {
  const [row] = await db
    .select({ ins: patientInsurances, patient: patients, payer: payers, practice: schema.practices })
    .from(patientInsurances)
    .innerJoin(patients, eq(patients.id, patientInsurances.patientId))
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .innerJoin(schema.practices, eq(schema.practices.id, patients.practiceId))
    .where(eq(patientInsurances.id, patientInsuranceId))
    .limit(1);
  if (!row) throw new Error("Insurance not found");
  const now = new Date();
  const date = serviceDate ?? now.toISOString().slice(0, 10);
  const traceNumber = "E" + now.getTime().toString(36).toUpperCase() + Math.floor(Math.random() * 1296).toString(36).toUpperCase();
  const request270 = build270({
    senderId: "COLLABORATMD", receiverId: row.payer.payerId, now, control: String(now.getTime() % 1_000_000_000), traceNumber,
    payer: { name: row.payer.name, payerId: row.payer.payerId },
    provider: { name: row.practice.name, npi: row.practice.npi },
    subscriber: { lastName: row.patient.lastName, firstName: row.patient.firstName, memberId: row.ins.memberId, dob: row.patient.dob, sex: row.patient.sex },
    serviceDate: date,
  });

  let response271: string | null = null;
  let summary: EligibilitySummary;
  try {
    const answer = await getClearinghouse((await practiceConfig(db, row.practice.id)).stedi?.apiKey).checkEligibility(request270);
    response271 = answer.raw;
    const parsed = answer.response;
    summary = parsed.traceNumber && parsed.traceNumber !== traceNumber
      ? { status: "error", message: `The 271 answered a different inquiry (trace ${parsed.traceNumber})` }
      : summarize271(parsed);
  } catch (e) {
    summary = { status: "error", message: e instanceof Error ? e.message : "The clearinghouse did not answer" };
  }

  const [check] = await db
    .insert(eligibilityChecks)
    .values({
      patientInsuranceId,
      status: summary.status,
      planName: summary.planName ?? null,
      copayCents: summary.copayCents ?? null,
      deductibleCents: summary.deductibleCents ?? null,
      deductibleRemainingCents: summary.deductibleRemainingCents ?? null,
      oopMaxCents: summary.oopMaxCents ?? null,
      coinsurancePct: summary.coinsurancePct ?? null,
      oopRemainingCents: summary.oopRemainingCents ?? null,
      response: { transaction: "271", status: summary.status, ...(summary.message ? { message: summary.message } : {}) },
      serviceDate: date,
      traceNumber,
      request270,
      response271,
      message: summary.message ?? null,
    })
    .returning();
  if (summary.copayCents) await db.update(patientInsurances).set({ copayCents: summary.copayCents }).where(eq(patientInsurances.id, patientInsuranceId));
  return check;
}

export interface ScheduleVerification {
  checked: number;
  active: number;
  inactive: number;
  errors: number;
  noInsurance: number;
  skipped: number;
  problems: { patientId: string; name: string; message: string }[];
}

/**
 * Verifies coverage for everyone on a day's schedule, the way a front desk
 * does the afternoon before. A patient whose insurance was already checked
 * for that date of service is skipped unless `force` is set.
 */
export async function verifySchedule(db: Db, practiceId: string, day: Date, force = false): Promise<ScheduleVerification> {
  const appts = (await listAppointments(db, practiceId, day)).filter((a) => a.appt.status !== "cancelled");
  const date = day.toISOString().slice(0, 10);
  const out: ScheduleVerification = { checked: 0, active: 0, inactive: 0, errors: 0, noInsurance: 0, skipped: 0, problems: [] };
  const seen = new Set<string>();
  for (const { appt, patient } of appts) {
    if (seen.has(appt.patientId)) continue;
    seen.add(appt.patientId);
    const name = `${patient.lastName}, ${patient.firstName}`;
    const [ins] = await db
      .select()
      .from(patientInsurances)
      .where(and(eq(patientInsurances.patientId, appt.patientId), eq(patientInsurances.active, true)))
      .orderBy(asc(patientInsurances.rank))
      .limit(1);
    if (!ins) {
      out.noInsurance++;
      out.problems.push({ patientId: appt.patientId, name, message: "No active insurance on file: collect it at check-in or treat as self-pay" });
      continue;
    }
    if (!force) {
      const [prior] = await db
        .select({ id: eligibilityChecks.id })
        .from(eligibilityChecks)
        .where(and(eq(eligibilityChecks.patientInsuranceId, ins.id), eq(eligibilityChecks.serviceDate, date), eq(eligibilityChecks.status, "active")))
        .limit(1);
      if (prior) {
        out.skipped++;
        continue;
      }
    }
    const check = await runEligibility(db, ins.id, date);
    out.checked++;
    if (check.status === "active") out.active++;
    else {
      if (check.status === "inactive") out.inactive++;
      else out.errors++;
      out.problems.push({ patientId: appt.patientId, name, message: check.message ?? (check.status === "inactive" ? "Coverage not active" : "The payer did not answer") });
    }
  }
  return out;
}

/** The most recent check for each insurance, for showing coverage beside the schedule. */
export async function latestChecks(db: Db, patientInsuranceIds: string[]) {
  if (!patientInsuranceIds.length) return new Map<string, typeof eligibilityChecks.$inferSelect>();
  const rows = await db
    .selectDistinctOn([eligibilityChecks.patientInsuranceId])
    .from(eligibilityChecks)
    .where(inArray(eligibilityChecks.patientInsuranceId, patientInsuranceIds))
    .orderBy(eligibilityChecks.patientInsuranceId, desc(eligibilityChecks.checkedAt));
  return new Map(rows.map((r) => [r.patientInsuranceId, r]));
}

export async function postPatientPayment(db: Db, practiceId: string, patientId: string, amountCents: number, method: string, userId?: string) {
  await db.insert(ledgerEntries).values({ practiceId, patientId, type: "patient_payment", amountCents, note: `Patient payment (${method})`, postedBy: userId ?? null });
}
