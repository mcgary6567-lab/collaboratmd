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
  automation: jsonb("automation").$type<AutomationSettings>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AutomationSettings = {
  appointmentReminders?: boolean;
  balanceReminders?: boolean;
  weeklyReport?: boolean;
  claimFollowUp?: boolean;
  autopay?: boolean;
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
