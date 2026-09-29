import { claimParties } from "./claim-edi";
import { checkUsAddress } from "@/lib/us";
import type { SubscriberInput } from "@/lib/subscriber-form";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getClearinghouse } from "@/lib/clearinghouse/gateway";
import { build270, summarize271, type EligibilitySummary } from "@/lib/edi/x270";
import { birthdayRuleCheck } from "@/lib/cob/birthday-rule";
import { listAppointments } from "./encounters";
import { practiceConfig } from "./integrations";
import { emit } from "./webhooks";
import { notify } from "./notifications";
import { clockDay, practiceNow } from "./practice-time";

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
  /** Null for a self-pay patient: no insurance row. */
  payerId: string | null;
  memberId: string;
  groupNumber?: string;
  relationship: string;
  copayCents: number;
  /** The insured person, required when relationship is not "self" (lib/edi/subscriber.ts). */
  subscriber?: SubscriberInput;
}

/** The insured person's columns for an insurance row: required for a dependent, empty for "self". */
export function subscriberColumns(relationship: string, s: SubscriberInput | undefined) {
  if (relationship === "self") return {};
  if (!s?.firstName || !s.lastName || !s.dob) throw new Error("Enter the insured person's name and date of birth: the claim names them as the subscriber");
  if (!["M", "F", "U"].includes(s.sex ?? "")) throw new Error("Choose the insured person's sex");
  const addr = checkUsAddress({ state: s.state, zip: s.zip });
  return {
    subscriberFirstName: s.firstName.slice(0, 60), subscriberLastName: s.lastName.slice(0, 60), subscriberDob: s.dob, subscriberSex: s.sex!,
    subscriberAddress1: s.address1?.slice(0, 120) ?? null, subscriberCity: s.city?.slice(0, 60) ?? null, subscriberState: addr.state, subscriberZip: addr.zip,
  };
}

export async function createPatient(db: Db, practiceId: string, input: NewPatientInput) {
  const addr = checkUsAddress(input);
  const subscriber = input.payerId ? subscriberColumns(input.relationship, input.subscriber) : {};
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
      phone: addr.phone,
      email: input.email || null,
      address1: input.address1 || null,
      city: input.city || null,
      state: addr.state,
      zip: addr.zip,
    })
    .returning();
  if (input.payerId) {
    await db.insert(patientInsurances).values({ patientId: p.id, payerId: input.payerId, memberId: input.memberId.trim(), groupNumber: input.groupNumber || null, rank: 1, relationship: input.relationship, copayCents: input.copayCents, ...subscriber });
  }
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
    // A dependent (a child on a parent's plan) is asked about under the insured person's name.
    ...(() => {
      const { subscriber, patient } = claimParties(row.patient, row.ins);
      const dependent = row.ins.relationship !== "self" && subscriber.relationship !== "self";
      return {
        subscriber: { lastName: subscriber.lastName, firstName: subscriber.firstName, memberId: row.ins.memberId, dob: subscriber.dob, sex: subscriber.sex },
        dependent: dependent ? { lastName: patient.lastName, firstName: patient.firstName, dob: patient.dob, sex: patient.sex } : null,
      };
    })(),
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
      response: { transaction: "271", status: summary.status, ...(summary.message ? { message: summary.message } : {}), ...(summary.medicareAdvantage && row.payer.type === "medicare" ? { medicareAdvantage: summary.medicareAdvantage } : {}), ...(summary.managedCare && row.payer.type === "medicaid" ? { managedCare: summary.managedCare } : {}) },
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
    const ma = medicareAdvantageOf(check.response);
    if (check.status === "active") {
      out.active++;
      if (ma) out.problems.push({ patientId: appt.patientId, name, message: `Enrolled in a Medicare Advantage plan (${ma.plan}): bill that plan, not Medicare. Update the patient's insurance.` });
      const mco = managedCareOf(check.response);
      if (mco) out.problems.push({ patientId: appt.patientId, name, message: `Medicaid says the patient is in a managed care plan (${mco.plan}): bill that plan, not state Medicaid. Update the patient's insurance.` });
    } else {
      if (check.status === "inactive") out.inactive++;
      else out.errors++;
      out.problems.push({ patientId: appt.patientId, name, message: check.message ?? (check.status === "inactive" ? "Coverage not active" : "The payer did not answer") });
    }
  }
  return out;
}

/** The Medicare Advantage plan a Medicare eligibility check found, if any. */
export function medicareAdvantageOf(response: Record<string, unknown> | null | undefined): { plan: string; payerId: string | null } | null {
  const ma = response?.medicareAdvantage as { plan?: unknown; payerId?: unknown } | undefined;
  return ma && typeof ma.plan === "string" ? { plan: ma.plan, payerId: typeof ma.payerId === "string" ? ma.payerId : null } : null;
}

/**
 * Claim check: a claim to traditional Medicare for a patient whose latest
 * Medicare eligibility check (within 90 days of the visit) says they are in a
 * Medicare Advantage plan. Medicare denies it; the plan should be billed.
 */
export async function medicareAdvantageFinding(db: Db, c: { patientInsuranceId: string; payerType: string; dateOfService: string }) {
  if (c.payerType !== "medicare") return null;
  const [check] = await db.select().from(eligibilityChecks).where(eq(eligibilityChecks.patientInsuranceId, c.patientInsuranceId)).orderBy(desc(eligibilityChecks.checkedAt)).limit(1);
  if (!check) return null;
  const when = check.serviceDate ?? check.checkedAt.toISOString().slice(0, 10);
  if (Math.abs(Date.parse(`${when}T12:00:00Z`) - Date.parse(`${c.dateOfService}T12:00:00Z`)) > 90 * 86_400_000) return null;
  const ma = medicareAdvantageOf(check.response);
  return ma
    ? { rule: "MEDICARE_ADVANTAGE", severity: "error" as const, field: "insurance", message: `Medicare's eligibility response on ${when} says the patient is in a Medicare Advantage plan (${ma.plan}${ma.payerId ? `, ID ${ma.payerId}` : ""}). Medicare will deny this claim: add the plan as the patient's insurance and bill it.` }
    : null;
}

/** The Medicaid managed care plan an eligibility check found, if any. */
export function managedCareOf(response: Record<string, unknown> | null | undefined): { plan: string; payerId: string | null } | null {
  const m = response?.managedCare as { plan?: unknown; payerId?: unknown } | undefined;
  return m && typeof m.plan === "string" ? { plan: m.plan, payerId: typeof m.payerId === "string" ? m.payerId : null } : null;
}

/**
 * Claim check: a claim to state Medicaid for a patient whose Medicaid check in
 * the same month as the visit named a managed care plan. Medicaid eligibility
 * is month by month, so only that month's answer counts.
 */
export async function medicaidManagedCareFinding(db: Db, c: { patientInsuranceId: string; payerType: string; dateOfService: string }) {
  if (c.payerType !== "medicaid") return null;
  const [check] = await db.select().from(eligibilityChecks).where(eq(eligibilityChecks.patientInsuranceId, c.patientInsuranceId)).orderBy(desc(eligibilityChecks.checkedAt)).limit(1);
  if (!check) return null;
  const when = check.serviceDate ?? check.checkedAt.toISOString().slice(0, 10);
  if (when.slice(0, 7) !== c.dateOfService.slice(0, 7)) return null;
  const mco = managedCareOf(check.response);
  return mco
    ? { rule: "MEDICAID_MANAGED_CARE", severity: "error" as const, field: "insurance", message: `Medicaid's eligibility response for ${when.slice(0, 7)} says the patient is enrolled in ${mco.plan}${mco.payerId ? ` (ID ${mco.payerId})` : ""}. State Medicaid will deny this claim: add the plan as the patient's insurance and bill it.` }
    : null;
}

/**
 * Monthly: Medicaid coverage for patients with a visit in the next 30 days,
 * checked once per calendar month (on the practice's clock), since Medicaid
 * eligibility and managed care enrollment change month to month.
 */
export async function recheckMedicaidMonthly(db: Db, practiceId: string, now = new Date(), limit = 100) {
  const today = clockDay(await practiceNow(db, practiceId, now));
  const from = today.toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const month = from.slice(0, 7);
  const { rows } = await db.execute<{ ins_id: string; dos: string; patient_id: string; name: string }>(sql`
    SELECT DISTINCT ON (pi.id) pi.id AS ins_id, a.starts_at::date::text AS dos, p.id AS patient_id, p.last_name || ', ' || p.first_name AS name
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN patient_insurances pi ON pi.patient_id = p.id AND pi.active
    JOIN payers py ON py.id = pi.payer_id AND py.type = 'medicaid'
    WHERE a.practice_id = ${practiceId} AND a.status <> 'cancelled' AND a.starts_at >= ${from}::date AND a.starts_at < (${to}::date + 1)
      AND NOT EXISTS (SELECT 1 FROM eligibility_checks ec WHERE ec.patient_insurance_id = pi.id AND to_char(ec.checked_at, 'YYYY-MM') = ${month} AND ec.status <> 'error')
    ORDER BY pi.id, a.starts_at
    LIMIT ${limit}`);
  const problems: { name: string; message: string }[] = [];
  for (const r of rows) {
    const check = await runEligibility(db, r.ins_id, r.dos);
    const mco = managedCareOf(check.response);
    if (check.status !== "active") problems.push({ name: r.name, message: check.message ?? "Medicaid coverage is not active" });
    else if (mco) problems.push({ name: r.name, message: `Enrolled in ${mco.plan}: bill that plan` });
  }
  if (problems.length) {
    await notify(db, practiceId, {
      kind: "medicaid_monthly", dedupeKey: `medicaid-${month}-${from}`, href: "/patients",
      title: `${problems.length} Medicaid patient${problems.length === 1 ? "" : "s"} with visits coming up need${problems.length === 1 ? "s" : ""} attention`,
      body: problems.slice(0, 8).map((p) => `${p.name}: ${p.message}`).join("\n"),
    });
  }
  return { checked: rows.length, problems: problems.length };
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

/** Claim check: the birthday rule for a dependent child covered on both parents' commercial plans. */
export async function birthdayRuleFinding(db: Db, patientId: string, payerSequence: string) {
  if (payerSequence !== "P") return null;
  const rows = await db.select({ ins: patientInsurances, payer: payers }).from(patientInsurances).innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.patientId, patientId), eq(patientInsurances.active, true)));
  const check = birthdayRuleCheck(rows.map((r) => ({ id: r.ins.id, rank: r.ins.rank, relationship: r.ins.relationship, subscriberDob: r.ins.subscriberDob, payerType: r.payer.type, payerName: r.payer.name })));
  return check ? { rule: "COB_BIRTHDAY", severity: "warning" as const, field: "insurance", message: check.message } : null;
}
