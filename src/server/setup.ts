/**
 * What a new practice still has to do before it bills, worked out from its
 * data rather than ticked by hand, so the checklist cannot drift from reality.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { isValidNpi } from "@/lib/scrub/rules";
import { clearinghouseName } from "@/lib/clearinghouse/gateway";
import { practiceConfig } from "./integrations";

export interface SetupStep {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  href: string;
  optional?: boolean;
}

const count = async (db: Db, q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);

export async function setupSteps(db: Db, practiceId: string): Promise<SetupStep[]> {
  const n = sql<number>`count(*)::int`;
  const [practice] = await db.select().from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1);
  const cfg = await practiceConfig(db, practiceId);
  const [providers, payers, schedules, contracts, users, patients, checks, submitted, keys, imports, requireMfa] = await Promise.all([
    count(db, db.select({ n }).from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true)))),
    count(db, db.select({ n }).from(schema.payers).where(eq(schema.payers.practiceId, practiceId))),
    count(db, db.select({ n }).from(schema.feeSchedules).where(and(eq(schema.feeSchedules.practiceId, practiceId), sql`${schema.feeSchedules.payerId} IS NULL`))),
    count(db, db.select({ n }).from(schema.feeSchedules).where(and(eq(schema.feeSchedules.practiceId, practiceId), isNotNull(schema.feeSchedules.payerId)))),
    count(db, db.select({ n }).from(schema.users).where(eq(schema.users.practiceId, practiceId))),
    count(db, db.select({ n }).from(schema.patients).where(eq(schema.patients.practiceId, practiceId))),
    count(db, db.select({ n }).from(schema.eligibilityChecks)
      .innerJoin(schema.patientInsurances, eq(schema.patientInsurances.id, schema.eligibilityChecks.patientInsuranceId))
      .innerJoin(schema.patients, eq(schema.patients.id, schema.patientInsurances.patientId))
      .where(eq(schema.patients.practiceId, practiceId))),
    count(db, db.select({ n }).from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), isNotNull(schema.claims.submittedAt)))),
    count(db, db.select({ n }).from(schema.integrationKeys).where(eq(schema.integrationKeys.practiceId, practiceId))),
    count(db, db.select({ n }).from(schema.importJobs).where(eq(schema.importJobs.practiceId, practiceId))),
    Promise.resolve(practice?.requireMfa ? 1 : 0),
  ]);
  const practiceOk = !!practice && isValidNpi(practice.npi) && /^\d{2}-?\d{7}$/.test(practice.taxId) && !!practice.address1 && !!practice.zip;
  return [
    { key: "practice", title: "Practice details", detail: "Group NPI, tax ID and billing address, as they appear on payer enrollments.", done: practiceOk, href: "/settings" },
    { key: "providers", title: "Providers", detail: "Each rendering provider with an individual NPI and taxonomy.", done: providers > 0, href: "/settings" },
    { key: "payers", title: "Payers", detail: "The insurers you bill, with their clearinghouse payer IDs and filing limits.", done: payers > 0, href: "/settings" },
    { key: "fees", title: "Standard fee schedule", detail: "What the practice charges for each code.", done: schedules > 0, href: "/settings/fees" },
    { key: "contracts", title: "Payer contracts", detail: "Contracted rates, so underpayments are caught.", done: contracts > 0, href: "/settings/fees", optional: true },
    { key: "team", title: "Team", detail: "Front desk, billers and administrators, each with the right role.", done: users > 1, href: "/settings" },
    { key: "mfa", title: "Two-factor sign-in", detail: "Require a code from an authenticator app for everyone.", done: requireMfa > 0, href: "/settings/security" },
    { key: "patients", title: "Patients", detail: "Import your patient list, connect your EHR, or add patients by hand.", done: patients > 0, href: "/import" },
    { key: "ehr", title: "EHR connection", detail: "An HL7 feed keeps patients and charges flowing in without re-keying.", done: keys > 0 || imports > 0, href: "/settings/integrations", optional: true },
    { key: "clearinghouse", title: "Live clearinghouse", detail: "Connect Stedi so claims and eligibility checks reach real payers.", done: clearinghouseName(cfg.stedi?.apiKey) === "Stedi", href: "/settings/connections" },
    { key: "payments", title: "Card payments", detail: "Connect Stripe so patients can pay online and at check-in.", done: !!cfg.stripe?.webhookSecret, href: "/settings/connections", optional: true },
    { key: "sms", title: "Text messages", detail: "Connect Twilio for reminders and text-to-pay.", done: !!cfg.twilio, href: "/settings/connections", optional: true },
    { key: "eligibility", title: "First eligibility check", detail: "Verify a patient's coverage before a visit.", done: checks > 0, href: "/scheduling" },
    { key: "claim", title: "First claim submitted", detail: "Enter charges and send a claim.", done: submitted > 0, href: "/encounters/new" },
    { key: "email", title: "Email delivery", detail: "Check-in links, reminders and reports by email (Resend).", done: !!cfg.resend, href: "/settings/connections", optional: true },
    { key: "ai", title: "AI assistance", detail: "Plain-language denial explanations, appeal letters and the denial agent (Claude).", done: !!cfg.anthropic, href: "/settings/connections", optional: true },
  ];
}
