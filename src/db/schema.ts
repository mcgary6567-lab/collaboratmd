import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
  bigint,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Tenancy                                                              */
/* ------------------------------------------------------------------ */

export const practices = pgTable("practices", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  taxId: text("tax_id").notNull(),
  npi: text("npi").notNull(),
  address1: text("address1").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  phone: text("phone"),
  requireMfa: boolean("require_mfa").notNull().default(false),
  sessionHours: integer("session_hours").notNull().default(12),
  ipAllowlist: jsonb("ip_allowlist").$type<string[]>().notNull().default([]),
  automation: jsonb("automation").$type<AutomationSettings>().notNull().default({}),
  policies: jsonb("policies").$type<PracticePolicies>().notNull().default({}),
  /** Menu items this practice has hidden (hrefs); they stay reachable by search and links. */
  hiddenNav: jsonb("hidden_nav").$type<string[]>().notNull().default([]),
  /** Sessions that started before this are ended ("sign everyone out"). */
  sessionsRevokedAt: timestamp("sessions_revoked_at", { withTimezone: true }),
  onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }),
  /** The practice's own patient financing lender, offered for larger balances. */
  financing: jsonb("financing").$type<{ lender: string; url: string; minCents: number } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Billing rules an administrator sets for the practice. See server/policies.ts for where each is enforced. */
export type PracticePolicies = {
  /** Non-administrators cannot write off more than this on one claim. */
  writeOffLimitCents?: number | null;
  /** Scrubber warnings block submission, like errors. */
  strictScrub?: boolean;
  /** Claims with a denial risk score at or above this need an administrator to submit. */
  riskHoldScore?: number | null;
  /** Statement batches: minimum balance, and days before the same patient is billed again. */
  statementMinCents?: number;
  statementIntervalDays?: number;
  /** Patient balances below this, untouched for `smallBalanceAgeDays`, are adjusted off daily. */
  smallBalanceCents?: number | null;
  smallBalanceAgeDays?: number;
  /** Only administrators can download CSV exports and the accounting journal. */
  exportsAdminOnly?: boolean;
  /** A refund must be approved by someone other than the person who requested it. */
  refundDualControl?: boolean;
};

export type AutomationSettings = {
  appointmentReminders?: boolean;
  balanceReminders?: boolean;
  weeklyReport?: boolean;
  claimFollowUp?: boolean;
  autopay?: boolean;
  denialAgent?: boolean;
};

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  error: text("error"),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("biller"), // admin | biller | front_desk | readonly
    mfaSecret: text("mfa_secret"),
    mfaPendingSecret: text("mfa_pending_secret"),
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
    mfaLastStep: bigint("mfa_last_step", { mode: "number" }),
    mfaRecovery: jsonb("mfa_recovery").$type<string[]>().notNull().default([]),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    sessionsRevokedAt: timestamp("sessions_revoked_at", { withTimezone: true }),
    passwordResetSentAt: timestamp("password_reset_sent_at", { withTimezone: true }),
    emailDigest: boolean("email_digest").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const providers = pgTable("providers", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  npi: text("npi").notNull(),
  taxonomy: text("taxonomy").notNull(),
  specialty: text("specialty").notNull(),
  active: boolean("active").notNull().default(true),
});

export const payers = pgTable("payers", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  payerId: text("payer_id").notNull(), // clearinghouse payer id
  type: text("type").notNull().default("commercial"), // commercial | medicare | medicaid | self_pay
  timelyFilingDays: integer("timely_filing_days").notNull().default(90),
  appealDays: integer("appeal_days").notNull().default(60),
});

/* ------------------------------------------------------------------ */
/* Patients                                                             */
/* ------------------------------------------------------------------ */

export const patients = pgTable(
  "patients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    mrn: text("mrn").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    dob: date("dob").notNull(),
    sex: text("sex").notNull(), // M | F | U
    phone: text("phone"),
    email: text("email"),
    address1: text("address1"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    smsConsentAt: timestamp("sms_consent_at", { withTimezone: true }),
    remindersOptOut: boolean("reminders_opt_out").notNull().default(false),
    fhirId: text("fhir_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("patients_mrn_idx").on(t.practiceId, t.mrn),
    index("patients_name_idx").on(t.lastName, t.firstName),
  ],
);

export const patientInsurances = pgTable("patient_insurances", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  memberId: text("member_id").notNull(),
  groupNumber: text("group_number"),
  rank: integer("rank").notNull().default(1), // 1 primary, 2 secondary, 3 tertiary
  relationship: text("relationship").notNull().default("self"), // self | spouse | child | other
  copayCents: integer("copay_cents").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const eligibilityChecks = pgTable("eligibility_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientInsuranceId: uuid("patient_insurance_id").notNull().references(() => patientInsurances.id),
  status: text("status").notNull(), // active | inactive | error
  planName: text("plan_name"),
  copayCents: integer("copay_cents"),
  deductibleCents: integer("deductible_cents"),
  deductibleRemainingCents: integer("deductible_remaining_cents"),
  oopMaxCents: integer("oop_max_cents"),
  coinsurancePct: numeric("coinsurance_pct", { precision: 5, scale: 2, mode: "number" }),
  oopRemainingCents: integer("oop_remaining_cents"),
  response: jsonb("response").$type<Record<string, unknown>>(),
  serviceDate: date("service_date"),
  traceNumber: text("trace_number"),
  request270: text("request_270"),
  response271: text("response_271"),
  message: text("message"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Scheduling                                                           */
/* ------------------------------------------------------------------ */

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    providerId: uuid("provider_id").notNull().references(() => providers.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    type: text("type").notNull().default("office_visit"),
    status: text("status").notNull().default("scheduled"), // scheduled | checked_in | completed | no_show | cancelled
    reason: text("reason"),
    fhirId: text("fhir_id"),
  },
  (t) => [index("appointments_start_idx").on(t.practiceId, t.startsAt)],
);

/* ------------------------------------------------------------------ */
/* Encounters & charges                                                 */
/* ------------------------------------------------------------------ */

export const encounters = pgTable("encounters", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  appointmentId: uuid("appointment_id").references(() => appointments.id),
  dateOfService: date("date_of_service").notNull(),
  placeOfService: text("place_of_service").notNull().default("11"),
  diagnoses: jsonb("diagnoses").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("open"), // open | billed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const charges = pgTable("charges", {
  id: uuid("id").defaultRandom().primaryKey(),
  encounterId: uuid("encounter_id").notNull().references(() => encounters.id),
  lineNumber: integer("line_number").notNull(),
  cpt: text("cpt").notNull(),
  modifiers: jsonb("modifiers").$type<string[]>().notNull().default([]),
  units: integer("units").notNull().default(1),
  chargeCents: integer("charge_cents").notNull(),
  dxPointers: jsonb("dx_pointers").$type<number[]>().notNull().default([1]),
  description: text("description"),
  /** Institutional lines: the revenue code (the procedure code may be blank). */
  revenueCode: text("revenue_code"),
  /** Dental lines (837D): tooth number, surfaces (e.g. MOD) and oral cavity area. */
  tooth: text("tooth"),
  surfaces: text("surfaces"),
  oralCavity: text("oral_cavity"),
});

/* ------------------------------------------------------------------ */
/* Claims                                                               */
/* ------------------------------------------------------------------ */

export const claims = pgTable(
  "claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    encounterId: uuid("encounter_id").notNull().references(() => encounters.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    payerId: uuid("payer_id").notNull().references(() => payers.id),
    patientInsuranceId: uuid("patient_insurance_id").notNull().references(() => patientInsurances.id),
    controlNumber: text("control_number").notNull(),
    payerClaimNumber: text("payer_claim_number"),
    frequencyCode: text("frequency_code").notNull().default("1"), // 1 original, 7 corrected, 8 void
    /** The claim this one replaces or voids (frequency 7 or 8). */
    originalClaimId: uuid("original_claim_id"),
    /** Sent in REF*F8; the payer's number for the claim being replaced or voided. */
    originalPayerClaimNumber: text("original_payer_claim_number"),
    /** Sent in REF*G1 when a prior authorization covers the claim. */
    authorizationNumber: text("authorization_number"),
    /** P primary, S secondary. A secondary claim carries the primary's adjudication. */
    payerSequence: text("payer_sequence").notNull().default("P"),
    /** professional (837P / CMS-1500) or institutional (837I / UB-04). */
    claimType: text("claim_type").notNull().default("professional"),
    /** Institutional claims: type of bill, statement period, admission and discharge details. */
    institutional: jsonb("institutional").$type<import("@/lib/edi/x837i").Institutional>(),
    /** On a secondary claim, the primary claim whose balance it bills. */
    primaryClaimId: uuid("primary_claim_id"),
    status: text("status").notNull().default("draft"),
    totalCents: integer("total_cents").notNull(),
    scrubResults: jsonb("scrub_results")
      .$type<{ rule: string; severity: "error" | "warning"; message: string; field?: string }[]>()
      .notNull()
      .default([]),
    edi837: text("edi_837"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    timelyFilingDeadline: date("timely_filing_deadline"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("claims_control_idx").on(t.practiceId, t.controlNumber),
    index("claims_status_idx").on(t.practiceId, t.status),
  ],
);

export const claimEvents = pgTable("claim_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  status: text("status").notNull(),
  source: text("source").notNull(), // system | clearinghouse | 277 | 835 | user
  message: text("message"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Remittance & ledger (append-only)                                    */
/* ------------------------------------------------------------------ */

export const remittances = pgTable("remittances", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  payerId: uuid("payer_id").references(() => payers.id),
  payerName: text("payer_name").notNull(),
  checkNumber: text("check_number").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paymentDate: date("payment_date").notNull(),
  raw835: text("raw_835").notNull(),
  posted: boolean("posted").notNull().default(false),
  postingSummary: jsonb("posting_summary").$type<Record<string, unknown>>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    claimId: uuid("claim_id").references(() => claims.id),
    chargeId: uuid("charge_id").references(() => charges.id),
    remittanceId: uuid("remittance_id").references(() => remittances.id),
    // charge | insurance_payment | patient_payment | adjustment | write_off | transfer_to_patient | discount | bad_debt | refund | reversal
    type: text("type").notNull(),
    amountCents: integer("amount_cents").notNull(),
    groupCode: text("group_code"), // CO | PR | OA | PI
    reasonCode: text("reason_code"), // CARC
    remarkCode: text("remark_code"), // RARC
    note: text("note"),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: timestamp("posted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ledger_claim_idx").on(t.claimId), index("ledger_patient_idx").on(t.patientId)],
);

export const denials = pgTable("denials", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  category: text("category").notNull(), // eligibility | authorization | coding | timely_filing | duplicate | medical_necessity | cob | other
  carc: text("carc").notNull(),
  rarc: text("rarc"),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("open"), // open | in_progress | appealed | resolved | written_off
  assignedTo: uuid("assigned_to").references(() => users.id),
  explanation: text("explanation"),
  nextSteps: jsonb("next_steps").$type<string[]>(),
  appealDeadline: date("appeal_deadline"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/* Reference data & audit                                               */
/* ------------------------------------------------------------------ */

export const cptCodes = pgTable("cpt_codes", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
  defaultFeeCents: integer("default_fee_cents").notNull(),
});

export const icd10Codes = pgTable("icd10_codes", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").references(() => practices.id),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  details: jsonb("details").$type<Record<string, unknown>>(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Fee schedules & contract compliance                                  */
/* ------------------------------------------------------------------ */

/**
 * With no payer, the practice's standard charge master (what it bills). With a
 * payer, that payer's contracted allowed amounts (what it should be paid).
 */
export const feeSchedules = pgTable("fee_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  payerId: uuid("payer_id").references(() => payers.id),
  name: text("name").notNull(),
  effectiveFrom: date("effective_from").notNull().defaultNow(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const feeScheduleItems = pgTable("fee_schedule_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  feeScheduleId: uuid("fee_schedule_id").notNull().references(() => feeSchedules.id, { onDelete: "cascade" }),
  cpt: text("cpt").notNull(),
  amountCents: integer("amount_cents").notNull(),
});

/** A paid claim whose allowed amount fell short of its contract. One per claim. */
export const underpayments = pgTable("underpayments", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  remittanceId: uuid("remittance_id").references(() => remittances.id),
  expectedAllowedCents: integer("expected_allowed_cents").notNull(),
  actualAllowedCents: integer("actual_allowed_cents").notNull(),
  varianceCents: integer("variance_cents").notNull(),
  status: text("status").notNull().default("open"), // open | appealed | recovered | accepted
  note: text("note"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  disputedAt: timestamp("disputed_at", { withTimezone: true }),
  recoveredCents: integer("recovered_cents"),
});

/* ------------------------------------------------------------------ */
/* Patient billing                                                      */
/* ------------------------------------------------------------------ */

export const discountPolicies = pgTable("discount_policies", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // self_pay | prompt_pay | hardship | courtesy
  percent: numeric("percent", { precision: 5, scale: 2, mode: "number" }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentPlans = pgTable("payment_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  totalCents: integer("total_cents").notNull(),
  installmentCount: integer("installment_count").notNull(),
  frequency: text("frequency").notNull().default("monthly"), // monthly | biweekly
  startDate: date("start_date").notNull(),
  status: text("status").notNull().default("active"), // active | completed | cancelled | defaulted
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const paymentPlanInstallments = pgTable("payment_plan_installments", {
  id: uuid("id").defaultRandom().primaryKey(),
  planId: uuid("plan_id").notNull().references(() => paymentPlans.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  dueDate: date("due_date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  paidCents: integer("paid_cents").notNull().default(0),
  status: text("status").notNull().default("scheduled"), // scheduled | partial | paid | missed
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export interface StatementVisit {
  claimId: string | null;
  dateOfService: string | null;
  provider: string | null;
  services: { cpt: string; description: string }[];
  chargesCents: number;
  insurancePaidCents: number;
  adjustmentsCents: number;
  patientPaidCents: number;
  youOweCents: number;
}

export const statements = pgTable("statements", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  statementNumber: text("statement_number").notNull(),
  statementDate: date("statement_date").notNull(),
  dueDate: date("due_date").notNull(),
  chargesCents: integer("charges_cents").notNull(),
  insurancePaidCents: integer("insurance_paid_cents").notNull(),
  adjustmentsCents: integer("adjustments_cents").notNull(),
  patientPaidCents: integer("patient_paid_cents").notNull(),
  amountDueCents: integer("amount_due_cents").notNull(),
  detail: jsonb("detail").$type<{ visits: StatementVisit[]; unappliedPaymentsCents: number; discountsCents: number }>().notNull(),
  status: text("status").notNull().default("generated"), // generated | sent | void
  channel: text("channel"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export interface EstimateLine {
  cpt: string;
  description: string;
  units: number;
  chargeCents: number;
  allowedCents: number;
}

export const estimates = pgTable("estimates", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  patientInsuranceId: uuid("patient_insurance_id").references(() => patientInsurances.id),
  estimateNumber: text("estimate_number").notNull(),
  kind: text("kind").notNull(), // insured | good_faith
  serviceDate: date("service_date"),
  lines: jsonb("lines").$type<EstimateLine[]>().notNull(),
  totalChargeCents: integer("total_charge_cents").notNull(),
  allowedCents: integer("allowed_cents").notNull(),
  insurancePaysCents: integer("insurance_pays_cents").notNull(),
  patientOwesCents: integer("patient_owes_cents").notNull(),
  basis: jsonb("basis").$type<Record<string, unknown>>().notNull(),
  validUntil: date("valid_until"),
  appointmentId: uuid("appointment_id"),
  depositRequestedAt: timestamp("deposit_requested_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Claim controls                                                       */
/* ------------------------------------------------------------------ */

export const claimAcknowledgments = pgTable("claim_acknowledgments", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  kind: text("kind").notNull(), // 999 | 277CA
  accepted: boolean("accepted").notNull(),
  code: text("code"),
  message: text("message"),
  raw: text("raw"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PayerEditParams = {
  modifiers?: string[];
  dxPrefixes?: string[];
  maxUnits?: number;
};

export const payerEdits = pgTable("payer_edits", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  payerId: uuid("payer_id").references(() => payers.id),
  kind: text("kind").notNull(), // auth_required | modifier_required | dx_required | max_units | not_covered
  cpt: text("cpt"),
  params: jsonb("params").$type<PayerEditParams>().notNull().default({}),
  severity: text("severity").notNull().default("error"),
  message: text("message").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const authorizations = pgTable("authorizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  authNumber: text("auth_number").notNull(),
  cpts: jsonb("cpts").$type<string[]>().notNull().default([]),
  unitsApproved: integer("units_approved"),
  unitsUsed: integer("units_used").notNull().default(0),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to").notNull(),
  status: text("status").notNull().default("active"), // active | cancelled
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Electronic prior authorization (X12 278) requests: see migration 0023 and server/prior-auth.ts. */
export const authRequests = pgTable("auth_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  cpts: jsonb("cpts").$type<string[]>().notNull().default([]),
  diagnoses: jsonb("diagnoses").$type<string[]>().notNull().default([]),
  units: integer("units").notNull().default(1),
  serviceFrom: date("service_from").notNull(),
  serviceTo: date("service_to").notNull(),
  status: text("status").notNull(),
  authNumber: text("auth_number"),
  validFrom: date("valid_from"),
  validTo: date("valid_to"),
  message: text("message"),
  authorizationId: uuid("authorization_id").references(() => authorizations.id),
  request278: text("request_278").notNull(),
  response278: text("response_278"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Compliance center: see migration 0025 and server/compliance.ts. */
export const accessReviews = pgTable("access_reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  usersReviewed: integer("users_reviewed").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const vendorAgreements = pgTable("vendor_agreements", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  vendor: text("vendor").notNull(),
  service: text("service").notNull(),
  handlesPhi: boolean("handles_phi").notNull().default(true),
  baaStatus: text("baa_status").notNull().default("not_recorded"),
  signedOn: date("signed_on"),
  notes: text("notes"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* National code sets (CMS NCCI and coverage policies): see migration 0026 and server/code-sets.ts. */
export const ncciPtp = pgTable("ncci_ptp", {
  column1: text("column1").notNull(),
  column2: text("column2").notNull(),
  effective: date("effective").notNull(),
  deletion: date("deletion"),
  modifierIndicator: text("modifier_indicator").notNull(),
  rationale: text("rationale"),
}, (t) => [primaryKey({ columns: [t.column1, t.column2, t.effective] })]);

export const ncciMue = pgTable("ncci_mue", {
  code: text("code").primaryKey(),
  maxUnits: integer("max_units").notNull(),
  adjudicationIndicator: text("adjudication_indicator"),
  rationale: text("rationale"),
});

export const coveragePolicyCodes = pgTable("coverage_policy_codes", {
  policyId: text("policy_id").notNull(),
  title: text("title").notNull(),
  cpt: text("cpt").notNull(),
  icd10: text("icd10").notNull(),
}, (t) => [primaryKey({ columns: [t.policyId, t.cpt, t.icd10] })]);

export const codeSetLoads = pgTable("code_set_loads", {
  id: uuid("id").defaultRandom().primaryKey(),
  codeSet: text("code_set").notNull(),
  label: text("label").notNull(),
  rows: integer("rows").notNull(),
  loadedBy: text("loaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const ruleSuggestionDismissals = pgTable("rule_suggestion_dismissals", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  suggestionKey: text("suggestion_key").notNull(),
  dismissedBy: uuid("dismissed_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.suggestionKey] })]);

/** SAML request IDs awaiting a response (see server/saml.ts). */
export const samlRequests = pgTable("saml_requests", {
  id: text("id").primaryKey(),
  practiceId: uuid("practice_id").references(() => practices.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Growth round: clearinghouse polling, notifications, credentialing, legacy A/R, FHIR. See migration 0033. */
export const clearinghousePolls = pgTable("clearinghouse_polls", {
  practiceId: uuid("practice_id").primaryKey().references(() => practices.id),
  cursor: text("cursor"),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  lastError: text("last_error"),
  erasImported: integer("eras_imported").notNull().default(0),
});

export const inboundTransactions = pgTable("inbound_transactions", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  transactionId: text("transaction_id").notNull(),
  transactionSet: text("transaction_set").notNull(),
  remittanceId: uuid("remittance_id").references(() => remittances.id),
  note: text("note"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.transactionId] })]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  userId: uuid("user_id").references(() => users.id),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  href: text("href"),
  dedupeKey: text("dedupe_key"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerCredentials = pgTable("provider_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  kind: text("kind").notNull(),
  identifier: text("identifier"),
  state: text("state"),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const legacyAr = pgTable("legacy_ar", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  payerName: text("payer_name"),
  sourceClaimNumber: text("source_claim_number"),
  dateOfService: date("date_of_service"),
  billedCents: integer("billed_cents").notNull(),
  balanceCents: integer("balance_cents").notNull(),
  responsibility: text("responsibility").notNull(),
  status: text("status").notNull().default("open"),
  batch: text("batch").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fhirConnections = pgTable("fhir_connections", {
  practiceId: uuid("practice_id").primaryKey().references(() => practices.id),
  baseUrl: text("base_url").notNull(),
  tokenSealed: text("token_sealed"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastResult: jsonb("last_result").$type<Record<string, unknown>>(),
});

/* Error monitoring, dental lines and claim attachments. See migration 0031. */
export const errorEvents = pgTable("error_events", {
  fingerprint: text("fingerprint").primaryKey(),
  message: text("message").notNull(),
  digest: text("digest"),
  routePath: text("route_path"),
  routeType: text("route_type"),
  method: text("method"),
  path: text("path"),
  count: integer("count").notNull().default(1),
  firstSeen: timestamp("first_seen", { withTimezone: true }).defaultNow().notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const claimAttachments = pgTable("claim_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  reportType: text("report_type").notNull(),
  transmission: text("transmission").notNull(),
  controlNumber: text("control_number").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  dataBase64: text("data_base64").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Operations: client invoicing, accounting export and close, work rules. See migration 0030. */
export type InvoiceIssuer = { name: string; address: string | null };
export const clientAgreements = pgTable("client_agreements", {
  practiceId: uuid("practice_id").primaryKey().references(() => practices.id),
  issuerName: text("issuer_name").notNull(),
  issuerAddress: text("issuer_address"),
  rateBps: integer("rate_bps").notNull(),
  minimumCents: integer("minimum_cents").notNull().default(0),
  includePatient: boolean("include_patient").notNull().default(true),
  termsDays: integer("terms_days").notNull().default(30),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const clientInvoices = pgTable("client_invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  number: text("number").notNull(),
  period: text("period").notNull(),
  insuranceCents: integer("insurance_cents").notNull(),
  patientCents: integer("patient_cents").notNull(),
  baseCents: integer("base_cents").notNull(),
  rateBps: integer("rate_bps").notNull(),
  feeCents: integer("fee_cents").notNull(),
  status: text("status").notNull().default("draft"),
  dueDate: date("due_date"),
  issuer: jsonb("issuer").$type<InvoiceIssuer>().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const accountingSettings = pgTable("accounting_settings", {
  practiceId: uuid("practice_id").primaryKey().references(() => practices.id),
  accounts: jsonb("accounts").$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const periodCloses = pgTable("period_closes", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  period: text("period").notNull(),
  totals: jsonb("totals").$type<Record<string, number>>().notNull(),
  closedBy: uuid("closed_by").references(() => users.id),
  closedAt: timestamp("closed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.period] })]);

export type WorkConditions = { payerIds?: string[]; minCents?: number; categories?: string[]; minAgeDays?: number };
export const workRules = pgTable("work_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  conditions: jsonb("conditions").$type<WorkConditions>().notNull().default({}),
  assigneeIds: jsonb("assignee_ids").$type<string[]>().notNull().default([]),
  slaDays: integer("sla_days").notNull().default(5),
  priority: text("priority").notNull().default("normal"),
  active: boolean("active").notNull().default(true),
  nextIndex: integer("next_index").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Access control: custom roles, SSO and SCIM. See migration 0029 and server/access.ts, server/sso.ts. */
export const customRoles = pgTable("custom_roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  baseRole: text("base_role").notNull(),
  denied: jsonb("denied").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const practiceSso = pgTable("practice_sso", {
  practiceId: uuid("practice_id").primaryKey().references(() => practices.id),
  /** oidc or saml. */
  protocol: text("protocol").notNull().default("oidc"),
  issuer: text("issuer"),
  clientId: text("client_id"),
  clientSecretSealed: text("client_secret_sealed"),
  samlEntryPoint: text("saml_entry_point"),
  samlIdpIssuer: text("saml_idp_issuer"),
  samlIdpCert: text("saml_idp_cert"),
  domains: jsonb("domains").$type<string[]>().notNull().default([]),
  enforce: boolean("enforce").notNull().default(false),
  autoProvision: boolean("auto_provision").notNull().default(false),
  defaultRole: text("default_role").notNull().default("readonly"),
  scimTokenHash: text("scim_token_hash"),
  scimTokenHint: text("scim_token_hint"),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Front desk: two-way texting and coverage discovery. See migration 0028. */
export const smsMessages = pgTable("sms_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").references(() => patients.id),
  direction: text("direction").notNull(), // in | out
  phone: text("phone").notNull(),
  body: text("body").notNull(),
  twilioSid: text("twilio_sid"),
  status: text("status").notNull().default("received"), // received | sent | failed
  readAt: timestamp("read_at", { withTimezone: true }),
  userId: uuid("user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const smsOptOuts = pgTable("sms_opt_outs", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  phone: text("phone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.phone] })]);

export const coverageSearches = pgTable("coverage_searches", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  status: text("status").notNull(), // found | not_found | error
  memberId: text("member_id"),
  planName: text("plan_name"),
  message: text("message"),
  addedInsuranceId: uuid("added_insurance_id").references(() => patientInsurances.id),
  checkedBy: uuid("checked_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Revenue recovery: see migration 0027 and server/recovery.ts. */
export const chargeReviewDismissals = pgTable("charge_review_dismissals", {
  appointmentId: uuid("appointment_id").primaryKey().references(() => appointments.id),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  reason: text("reason").notNull(),
  dismissedBy: uuid("dismissed_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  claimId: uuid("claim_id").references(() => claims.id),
  payee: text("payee").notNull(),
  payerId: uuid("payer_id").references(() => payers.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("requested"),
  method: text("method"),
  reference: text("reference"),
  ledgerEntryId: uuid("ledger_entry_id").references(() => ledgerEntries.id),
  requestedBy: uuid("requested_by").references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  issuedBy: uuid("issued_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
});

/**
 * Messages from the public contact form.
 *
 * Not tenant-scoped: a visitor sending one has no account and belongs to no
 * practice, so there is nothing to scope it by.
 */
export const contactMessages = pgTable("contact_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  organization: text("organization"),
  topic: text("topic").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("new"),
  /** Investor submissions only; null everywhere else. */
  fund: text("fund"),
  stage: text("stage"),
  checkSize: text("check_size"),
  /** Campaign parameters carried in on the landing URL. */
  source: jsonb("source").$type<Record<string, string>>(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export const claimStatusChecks = pgTable("claim_status_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  category: text("category"),
  statusCode: text("status_code"),
  entity: text("entity"),
  message: text("message"),
  paidCents: integer("paid_cents"),
  nextAction: text("next_action"),
  request276: text("request_276"),
  response277: text("response_277"),
  error: text("error"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Patient portal, online payments, messages                            */
/* ------------------------------------------------------------------ */

export const portalLinks = pgTable("portal_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  tokenHash: text("token_hash").notNull().unique(),
  purpose: text("purpose").notNull().default("portal"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const onlinePayments = pgTable("online_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  planId: uuid("plan_id").references(() => paymentPlans.id),
  provider: text("provider").notNull().default("stripe"),
  providerRef: text("provider_ref"),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("pending"),
  source: text("source").notNull(),
  ledgerEntryId: uuid("ledger_entry_id"),
  failure: text("failure"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const savedCards = pgTable("saved_cards", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  providerCustomer: text("provider_customer").notNull(),
  providerMethod: text("provider_method").notNull(),
  brand: text("brand"),
  last4: text("last4"),
  expMonth: integer("exp_month"),
  expYear: integer("exp_year"),
  autopayPlanId: uuid("autopay_plan_id").references(() => paymentPlans.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
});

export const messageLog = pgTable("message_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").references(() => patients.id),
  channel: text("channel").notNull(),
  kind: text("kind").notNull(),
  recipient: text("recipient").notNull(),
  entityId: uuid("entity_id"),
  status: text("status").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Appeals, deposits, enrollment, collections                           */
/* ------------------------------------------------------------------ */

export const appealLetters = pgTable("appeal_letters", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  denialId: uuid("denial_id").notNull().references(() => denials.id),
  body: text("body").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull().default("draft"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

/** The denial agent's proposals, waiting for review: see migration 0021 and server/denial-agent.ts. */
export const denialAgentItems = pgTable("denial_agent_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  denialId: uuid("denial_id").notNull().unique().references(() => denials.id),
  action: text("action").notNull(),
  title: text("title").notNull(),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  letterId: uuid("letter_id").references(() => appealLetters.id),
  resultClaimId: uuid("result_claim_id").references(() => claims.id),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("proposed"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ReportConfig = { columns: string[]; group?: string | null; range: string; payerId?: string | null; providerId?: string | null; status?: string | null };

/** Saved report-builder reports: see migration 0022 and server/report-builder.ts. */
export const customReports = pgTable("custom_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  dataset: text("dataset").notNull(),
  config: jsonb("config").$type<ReportConfig>().notNull(),
  schedule: text("schedule").notNull().default("none"),
  recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bankDeposits = pgTable("bank_deposits", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  depositDate: date("deposit_date").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  remittanceId: uuid("remittance_id").references(() => remittances.id),
  status: text("status").notNull().default("unmatched"),
  matchReason: text("match_reason"),
  fingerprint: text("fingerprint").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerEnrollments = pgTable("provider_enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  status: text("status").notNull().default("not_started"),
  payerProviderId: text("payer_provider_id"),
  submittedOn: date("submitted_on"),
  effectiveOn: date("effective_on"),
  revalidationDue: date("revalidation_due"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const patientCollections = pgTable("patient_collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  stage: text("stage").notNull(),
  amountCents: integer("amount_cents").notNull(),
  agency: text("agency"),
  finalNoticeAt: timestamp("final_notice_at", { withTimezone: true }),
  placedAt: timestamp("placed_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Work: tasks, notes, saved views                                      */
/* ------------------------------------------------------------------ */

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  title: text("title").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  assigneeId: uuid("assignee_id").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  dueDate: date("due_date"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("open"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  /** The work rule that created it, if any. */
  ruleId: uuid("rule_id"),
});

export const notes = pgTable("notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  userId: uuid("user_id").references(() => users.id),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const savedViews = pgTable("saved_views", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  page: text("page").notNull(),
  name: text("name").notNull(),
  query: text("query").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Multi-practice access                                                */
/* ------------------------------------------------------------------ */

export const practiceMemberships = pgTable(
  "practice_memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.practiceId] })],
);

/* ------------------------------------------------------------------ */
/* Integrations                                                         */
/* ------------------------------------------------------------------ */

/** Outside services a practice connects: see migration 0019 and server/integrations.ts. */
export const practiceIntegrations = pgTable(
  "practice_integrations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    provider: text("provider").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    settings: jsonb("settings").$type<Record<string, string | boolean>>().notNull().default({}),
    secrets: text("secrets"),
    secretHints: jsonb("secret_hints").$type<Record<string, string>>().notNull().default({}),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestOk: boolean("last_test_ok"),
    lastTestMessage: text("last_test_message"),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("practice_integrations_provider_idx").on(t.practiceId, t.provider)],
);

/** Public REST API keys: see migration 0020 and server/api-keys.ts. */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scope: text("scope").notNull().default("read"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  url: text("url").notNull(),
  description: text("description"),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  secret: text("secret").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

export const integrationKeys = pgTable("integration_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const integrationMessages = pgTable("integration_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  keyId: uuid("key_id").references(() => integrationKeys.id),
  source: text("source").notNull(),
  messageType: text("message_type").notNull(),
  controlId: text("control_id").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  result: jsonb("result").$type<Record<string, unknown>>(),
  raw: text("raw").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ImportMapping = Record<string, string | null>;

export const importJobs = pgTable("import_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  mapping: jsonb("mapping").$type<ImportMapping>().notNull(),
  mappedBy: text("mapped_by").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  created: integer("created").notNull().default(0),
  updated: integer("updated").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errors: jsonb("errors").$type<{ row: number; message: string }[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Labs                                                                 */
/* ------------------------------------------------------------------ */

export type LabOrderTest = { code: string; name: string; cpt: string };

export const labOrders = pgTable(
  "lab_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    practiceId: uuid("practice_id").notNull().references(() => practices.id),
    patientId: uuid("patient_id").notNull().references(() => patients.id),
    providerId: uuid("provider_id").notNull().references(() => providers.id),
    labCode: text("lab_code").notNull(),
    placerOrderNumber: text("placer_order_number").notNull(),
    fillerOrderNumber: text("filler_order_number"),
    tests: jsonb("tests").$type<LabOrderTest[]>().notNull(),
    diagnoses: jsonb("diagnoses").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("ordered"),
    ormMessage: text("orm_message").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resultedAt: timestamp("resulted_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("lab_orders_placer_idx").on(t.practiceId, t.placerOrderNumber)],
);

export const labResults = pgTable("lab_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => labOrders.id),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  testCode: text("test_code").notNull(),
  loinc: text("loinc").notNull(),
  name: text("name").notNull(),
  value: text("value").notNull(),
  units: text("units"),
  referenceRange: text("reference_range"),
  flag: text("flag"),
  status: text("status").notNull().default("F"),
  observedAt: date("observed_at"),
  receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Digital check-in                                                     */
/* ------------------------------------------------------------------ */

export const checkinLinks = pgTable("checkin_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CheckinDemographics = { phone: string; email: string; address1: string; city: string; state: string; zip: string };
export type CheckinInsurance = {
  /** Unchanged: the card on file is still current. */
  sameAsOnFile: boolean;
  payerName: string;
  memberId: string;
  groupNumber: string;
  relationship: string;
};
export type CheckinConsents = { privacyNotice: boolean; financialPolicy: boolean; assignmentOfBenefits: boolean; signature: string; signedAt: string };

export const checkinSubmissions = pgTable("checkin_submissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  linkId: uuid("link_id").notNull().references(() => checkinLinks.id),
  appointmentId: uuid("appointment_id").notNull().references(() => appointments.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  demographics: jsonb("demographics").$type<CheckinDemographics>().notNull(),
  insurance: jsonb("insurance").$type<CheckinInsurance>().notNull(),
  consents: jsonb("consents").$type<CheckinConsents>().notNull(),
  status: text("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CheckinLink = typeof checkinLinks.$inferSelect;
export type CheckinSubmission = typeof checkinSubmissions.$inferSelect;
export type ContactMessage = typeof contactMessages.$inferSelect;
export type FeeSchedule = typeof feeSchedules.$inferSelect;
export type Underpayment = typeof underpayments.$inferSelect;
export type DiscountPolicy = typeof discountPolicies.$inferSelect;
export type PaymentPlan = typeof paymentPlans.$inferSelect;
export type PaymentPlanInstallment = typeof paymentPlanInstallments.$inferSelect;
export type Statement = typeof statements.$inferSelect;
export type Estimate = typeof estimates.$inferSelect;
export type ClaimAcknowledgment = typeof claimAcknowledgments.$inferSelect;
export type PayerEdit = typeof payerEdits.$inferSelect;
export type Authorization = typeof authorizations.$inferSelect;
export type Practice = typeof practices.$inferSelect;
export type User = typeof users.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type Payer = typeof payers.$inferSelect;
export type Patient = typeof patients.$inferSelect;
export type PatientInsurance = typeof patientInsurances.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type Encounter = typeof encounters.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Claim = typeof claims.$inferSelect;
export type ClaimEvent = typeof claimEvents.$inferSelect;
export type Remittance = typeof remittances.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type Denial = typeof denials.$inferSelect;
export type ScrubResult = Claim["scrubResults"][number];
