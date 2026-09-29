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
  smallint,
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
  /** For "today", "tomorrow" and online booking; see server/practice-time.ts and migration 0046. */
  timeZone: text("time_zone").notNull().default("America/New_York"),
  requireMfa: boolean("require_mfa").notNull().default(false),
  /** Two-factor for administrators and anyone who can export, whatever requireMfa says (server/mfa-policy.ts); migration 0051. */
  mfaForPrivileged: boolean("mfa_for_privileged").notNull().default(false),
  sessionHours: integer("session_hours").notNull().default(12),
  ipAllowlist: jsonb("ip_allowlist").$type<string[]>().notNull().default([]),
  automation: jsonb("automation").$type<AutomationSettings>().notNull().default({}),
  policies: jsonb("policies").$type<PracticePolicies>().notNull().default({}),
  /** Menu items this practice has hidden (hrefs); they stay reachable by search and links. */
  hiddenNav: jsonb("hidden_nav").$type<string[]>().notNull().default([]),
  /** Sessions that started before this are ended ("sign everyone out"). */
  sessionsRevokedAt: timestamp("sessions_revoked_at", { withTimezone: true }),
  onboardingDismissedAt: timestamp("onboarding_dismissed_at", { withTimezone: true }),
  /** The seeded demo practice (published sign-ins): the only one public pages read from. Migration 0052. */
  isDemo: boolean("is_demo").notNull().default(false),
  /** Who bills: "organization" (Type 2 NPI) or "individual", a solo provider under their Type 1 NPI and name. Migration 0053. */
  billingEntity: text("billing_entity").notNull().default("organization"),
  billingLastName: text("billing_last_name"),
  billingFirstName: text("billing_first_name"),
  /** CLIA certificate number, sent on claims with laboratory tests (REF*X4). */
  cliaNumber: text("clia_number"),
  /** Paper claim printing: how far to shift the data on a pre-printed CMS-1500, in tenths of a millimetre (right and down). */
  formOffsetX: integer("form_offset_x").notNull().default(0),
  /** The Medicare payment locality (MAC number and locality number), for the physician fee schedule. */
  medicareCarrier: text("medicare_carrier"),
  medicareLocality: text("medicare_locality"),
  formOffsetY: integer("form_offset_y").notNull().default(0),
  /** For 837 files sent through another clearinghouse: the IDs it assigned (ISA06/GS02 and ISA08/GS03). */
  ediSubmitterId: text("edi_submitter_id"),
  ediReceiverId: text("edi_receiver_id"),
  /** The practice's own patient financing lender, offered for larger balances. */
  financing: jsonb("financing").$type<{ lender: string; url: string; minCents: number } | null>(),
  /* The practice's own subscription to CollaboratMD. See server/subscription.ts. */
  selfServe: boolean("self_serve").notNull().default(false),
  plan: text("plan"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  subscriptionStatus: text("subscription_status").notNull().default("none"),
  billingEmail: text("billing_email"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeSubscriptionItemId: text("stripe_subscription_item_id"),
  seats: integer("seats"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  claimsReportedThrough: timestamp("claims_reported_through", { withTimezone: true }),
  /** When the subscription first went past due; claims keep going out for a grace period after it. */
  pastDueSince: timestamp("past_due_since", { withTimezone: true }),
  /** Scheduled deletion of all the practice's data (Settings > Close account). */
  closingAt: timestamp("closing_at", { withTimezone: true }),
  closingRequestedBy: uuid("closing_requested_by"),
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
  /** Thresholds for the chart access review (server/access-anomalies.ts); unset ones use its defaults. */
  accessReview?: { chartsPerDay?: number; multiple?: number; minForMultiple?: number; unrelatedPerDay?: number };
  /** Diagnosis prefixes the practice counts as chronic conditions, for finding care management candidates. */
  chronicPrefixes?: string[];
};

export type AutomationSettings = {
  appointmentReminders?: boolean;
  /** A second reminder on the morning of the visit, to patients who have not confirmed. */
  sameDayReminders?: boolean;
  balanceReminders?: boolean;
  weeklyReport?: boolean;
  claimFollowUp?: boolean;
  autopay?: boolean;
  denialAgent?: boolean;
  /** Each evening, check coverage for the next day's appointments. */
  eligibilityTomorrow?: boolean;
  /** Re-check Medicaid coverage once a month for patients with visits coming up. Migration 0058 (no column; settings are jsonb). */
  medicaidMonthly?: boolean;
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
  /** MD, DO, NP, PA, CNS, CNM or other: NPs, PAs and CNSs are paid 85% of Medicare's fee schedule under their own NPI. Migration 0057. */
  credential: text("credential"),
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
    /** en | es: statements, reminders and confirmations are sent in it. See migration 0045. */
    preferredLanguage: text("preferred_language").notNull().default("en"),
    /** Opening this patient's records asks for a reason (migration 0049, server/restricted.ts). */
    restricted: boolean("restricted").notNull().default(false),
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
  /** The insured person when relationship is not "self" (migration 0052; lib/edi/subscriber.ts). The address may be left empty when it is the patient's. */
  subscriberFirstName: text("subscriber_first_name"),
  subscriberLastName: text("subscriber_last_name"),
  subscriberDob: date("subscriber_dob"),
  subscriberSex: text("subscriber_sex"),
  subscriberAddress1: text("subscriber_address1"),
  subscriberCity: text("subscriber_city"),
  subscriberState: text("subscriber_state"),
  subscriberZip: text("subscriber_zip"),
  /** When Medicare pays second: the Medicare Secondary Payer type (12 working aged, 13 ESRD, 14 no-fault, 15 workers' comp, 16 public health, 41 black lung, 42 VA, 43 disability, 47 liability), sent as SBR05. */
  mspType: text("msp_type"),
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
    /** When the patient confirmed, and how ("sms"): see migration 0049. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedVia: text("confirmed_via"),
    reason: text("reason"),
    fhirId: text("fhir_id"),
    locationId: uuid("location_id").references(() => locations.id),
  },
  (t) => [index("appointments_start_idx").on(t.practiceId, t.startsAt), index("appointments_patient_idx").on(t.patientId, t.startsAt)],
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
  locationId: uuid("location_id").references(() => locations.id),
  diagnoses: jsonb("diagnoses").$type<string[]>().notNull().default([]),
  /** The referring provider, when the payer needs one (2310A NM1*DN). Migration 0053. */
  referringLastName: text("referring_last_name"),
  referringFirstName: text("referring_first_name"),
  referringNpi: text("referring_npi"),
  /** The physician supervising the service (2310D NM1*DQ, box 17 DQ). Migration 0057. */
  supervisingProviderId: uuid("supervising_provider_id").references(() => providers.id),
  /** A split/shared facility visit: the other practitioner, and the attestation that the billing one did the substantive portion (FS). Migration 0058. */
  sharedWithProviderId: uuid("shared_with_provider_id").references(() => providers.id),
  substantiveAttested: boolean("substantive_attested").notNull().default(false),
  /** Teaching setting: the teaching physician was present for the key or critical portion (GC). Migration 0058. */
  teachingPresent: boolean("teaching_present").notNull().default(false),
  /** Whether the condition is related to employment, an auto accident (and its state) or another accident (CLM11, box 10). */
  relatedEmployment: boolean("related_employment").notNull().default(false),
  relatedAuto: boolean("related_auto").notNull().default(false),
  autoAccidentState: text("auto_accident_state"),
  relatedOther: boolean("related_other").notNull().default(false),
  accidentDate: date("accident_date"),
  /** Workers' comp or auto insurer's claim number (REF*Y4, box 11b) and the employer. */
  propertyClaimNumber: text("property_claim_number"),
  employerName: text("employer_name"),
  status: text("status").notNull().default("open"), // open | billed
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const charges = pgTable("charges", {
  id: uuid("id").defaultRandom().primaryKey(),
  encounterId: uuid("encounter_id").notNull().references(() => encounters.id),
  lineNumber: integer("line_number").notNull(),
  /** Minutes, for time-based codes: therapy (8-minute rule) and anesthesia (reported in minutes). */
  minutes: integer("minutes"),
  /** A drug line's National Drug Code (11 digits), unit (UN, ML, GR, F2, ME) and quantity: 2410 LIN/CTP, required by Medicaid and many payers. */
  ndc: text("ndc"),
  ndcUnit: text("ndc_unit"),
  ndcQuantity: numeric("ndc_quantity", { mode: "number" }),
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
    /** Medicare forwarded the claim to this supplemental payer itself (a crossover), so it is not billed again. */
    crossoverPayer: text("crossover_payer"),
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
  /** A header code (a category) is not billable: the claim needs a more specific code under it. */
  billable: boolean("billable").notNull().default(true),
  /** The first and the latest fiscal year (October to September) whose CMS file listed the code; null for codes not from a CMS file. */
  firstYear: integer("first_year"),
  seenYear: integer("seen_year"),
});

/** HCPCS Level II (supplies, drugs, some services), from CMS's public annual file. */
export const hcpcsCodes = pgTable("hcpcs_codes", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
  shortDescription: text("short_description"),
  addedOn: date("added_on"),
  terminatedOn: date("terminated_on"),
});

/** Procedure codes a practice bills beyond the built-in list, with its own descriptions. */
export const practiceCodes = pgTable("practice_codes", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  code: text("code").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.code] })]);

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
  rules: jsonb("rules").$type<ContractRules>(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const feeScheduleItems = pgTable("fee_schedule_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  feeScheduleId: uuid("fee_schedule_id").notNull().references(() => feeSchedules.id, { onDelete: "cascade" }),
  cpt: text("cpt").notNull(),
  amountCents: integer("amount_cents").notNull(),
  /** Subject to the contract's multiple-procedure reduction. */
  mppr: boolean("mppr").notNull().default(false),
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
  mailId: text("mail_id"),
  mailStatus: text("mail_status"),
  mailedAt: timestamp("mailed_at", { withTimezone: true }),
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
  /** Frequency limits: at most maxCount services in periodDays (0 for a lifetime). */
  maxCount?: number;
  periodDays?: number;
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
  /** token: a pasted bearer token; smart: SMART backend services (signed JWT, client credentials). */
  authMode: text("auth_mode").notNull().default("token"),
  clientId: text("client_id"),
  tokenUrl: text("token_url"),
  scope: text("scope"),
  keyId: text("key_id"),
  privateKeySealed: text("private_key_sealed"),
  publicJwk: jsonb("public_jwk").$type<Record<string, unknown>>(),
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
  lastRequestId: text("last_request_id"),
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
  /** The file itself, unless it lives in the external store under storageKey (server/files.ts). */
  dataBase64: text("data_base64"),
  storageKey: text("storage_key"),
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
  /** Card on file: the patient authorized charging balances after insurance, up to this much each time. Migration 0059. */
  balanceMaxCents: integer("balance_max_cents"),
  balanceAuthorizedAt: timestamp("balance_authorized_at", { withTimezone: true }),
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
  /** May read restricted patients (each read goes on the patient's access log); migration 0050. */
  restrictedAccess: boolean("restricted_access").notNull().default(false),
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

/* Attempt counters per hashed caller address. See migration 0035 and server/throttle.ts. */
export const authThrottle = pgTable("auth_throttle", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).defaultNow().notNull(),
  count: integer("count").default(0).notNull(),
});

/* Operator alert state. See migration 0036 and server/ops-alerts.ts. */
export const opsAlerts = pgTable("ops_alerts", {
  kind: text("kind").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).defaultNow().notNull(),
  hits: integer("hits").default(0).notNull(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
});

/* Product gaps round. See migration 0037. */
export type ContractRules = {
  /** Percent paid for each procedure after the highest-paid one, among codes marked mppr (Medicare uses 50). */
  mpprPercent?: number | null;
  /** Percent of the rate paid when a line carries the modifier, e.g. { "50": 150, "80": 16 }. */
  modifiers?: Record<string, number>;
};

export const transactionEnrollments = pgTable("transaction_enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  transaction: text("transaction").notNull(),
  status: text("status").notNull().default("not_started"),
  submittedOn: date("submitted_on"),
  approvedOn: date("approved_on"),
  reference: text("reference"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("transaction_enrollments_practice_id_payer_id_transaction_key").on(t.practiceId, t.payerId, t.transaction)]);

export const terminalPayments = pgTable("terminal_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  readerId: text("reader_id").notNull(),
  paymentIntentId: text("payment_intent_id").notNull().unique(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull().default("waiting"), // waiting | succeeded | failed | canceled
  failure: text("failure"),
  ledgerEntryId: uuid("ledger_entry_id"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const locations = pgTable("locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  npi: text("npi"),
  address1: text("address1").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  placeOfService: text("place_of_service").notNull().default("11"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Self-serve signups waiting for email confirmation. See migration 0038 and server/signup.ts. */
export const signups = pgTable("signups", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  practiceName: text("practice_name").notNull(),
  plan: text("plan"),
  passwordHash: text("password_hash").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  practiceId: uuid("practice_id").references(() => practices.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Integration doctor results. See migration 0039 and server/doctor.ts. */
export const integrationChecks = pgTable("integration_checks", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  checkId: text("check_id").notNull(),
  status: text("status").notNull(), // pass | warn | fail | skip
  detail: text("detail").notNull(),
  ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
  ranBy: uuid("ran_by").references(() => users.id),
});

/* Background practice exports. See migration 0040. */
export const exportJobs = pgTable("export_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  requestedBy: uuid("requested_by").references(() => users.id),
  status: text("status").notNull().default("queued"), // queued | running | done | failed | expired
  storageKey: text("storage_key"),
  bytes: bigint("bytes", { mode: "number" }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Parts to build, one run each (server/export-jobs.ts); empty for a single-part export. */
  plan: jsonb("plan").$type<ExportSegment[][]>(),
  parts: jsonb("parts").$type<{ key: string; bytes: number }[]>().notNull().default([]),
  nextPart: integer("next_part").notNull().default(0),
});

/** A slice of one table (rows after an id, up to a limit), or a run of attachments. */
export type ExportSegment = { table: string; afterId: string | null; limit: number | null; label: string } | { attachments: string[] };

/* Platform operations. See migration 0041. */
export const lifecycleEmails = pgTable("lifecycle_emails", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  kind: text("kind").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.kind] })]);

export const legalAcceptances = pgTable("legal_acceptances", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  document: text("document").notNull(),
  version: text("version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
  ipHash: text("ip_hash"),
});

export const practiceDeletions = pgTable("practice_deletions", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull(),
  practiceName: text("practice_name").notNull(),
  requestedByEmail: text("requested_by_email"),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).defaultNow().notNull(),
  rowsDeleted: integer("rows_deleted").notNull(),
  filesDeleted: integer("files_deleted").notNull(),
});

/* Import templates and online booking. See migration 0043. */
export const importTemplates = pgTable("import_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  name: text("name").notNull(),
  /** Field key to the header it came from, e.g. { dob: "Patient DOB" }. */
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("import_templates_practice_id_name_key").on(t.practiceId, t.name)]);

export const bookingSettings = pgTable("booking_settings", {
  practiceId: uuid("practice_id").primaryKey().references(() => practices.id),
  enabled: boolean("enabled").notNull().default(false),
  // time_zone moved to practices (migration 0046) and was dropped by migration 0048.
  slotMinutes: integer("slot_minutes").notNull().default(30),
  minNoticeHours: integer("min_notice_hours").notNull().default(24),
  horizonDays: integer("horizon_days").notNull().default(21),
  intro: text("intro"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerHours = pgTable("provider_hours", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  locationId: uuid("location_id").references(() => locations.id),
  /** 0 Sunday to 6 Saturday, in the practice's time zone. */
  weekday: integer("weekday").notNull(),
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
});

export const bookingRequests = pgTable("booking_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  /** "appointment" (a time) or "waitlist" (no time; migration 0051). */
  kind: text("kind").notNull().default("appointment"),
  /** For an appointment always; for the waitlist, when the patient wants one provider. */
  providerId: uuid("provider_id").references(() => providers.id),
  locationId: uuid("location_id").references(() => locations.id),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  /** Waitlist: the clock hours the patient can come (null is any). */
  fromHour: smallint("from_hour"),
  untilHour: smallint("until_hour"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dob: date("dob").notNull(),
  phone: text("phone"),
  email: text("email"),
  reason: text("reason"),
  payerName: text("payer_name"),
  memberId: text("member_id"),
  smsConsent: boolean("sms_consent").notNull().default(false),
  language: text("language").notNull().default("en"),
  status: text("status").notNull().default("pending"), // pending | confirmed | declined
  appointmentId: uuid("appointment_id").references(() => appointments.id),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: uuid("decided_by").references(() => users.id),
});

/* Pilot operations. See migration 0044. */
export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  userId: uuid("user_id").references(() => users.id),
  page: text("page").notNull(),
  message: text("message").notNull(),
  userAgent: text("user_agent"),
  viewport: text("viewport"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  reply: text("reply"),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  repliedBy: uuid("replied_by").references(() => users.id),
});

/* Feature suggestions a practice dismissed. See migration 0045. */
export const dismissedTips = pgTable("dismissed_tips", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  tip: text("tip").notNull(),
  dismissedBy: uuid("dismissed_by").references(() => users.id),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.tip] })]);

export const featureUsage = pgTable("feature_usage", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  feature: text("feature").notNull(),
  day: date("day").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.practiceId, t.feature, t.day] })]);

/* Waitlist: a cancelled time is offered by text; the first to reply B gets it. See migration 0050 and server/waitlist.ts. */
export const waitlistEntries = pgTable("waitlist_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  /** Only this provider's openings, or any provider's when null. */
  providerId: uuid("provider_id").references(() => providers.id),
  note: text("note"),
  /** The clock hours at the practice the patient can come, [from, until); null is any. Migration 0051. */
  fromHour: smallint("from_hour"),
  untilHour: smallint("until_hour"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedReason: text("closed_reason"),
});

export const slotOffers = pgTable("slot_offers", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  cancelledAppointmentId: uuid("cancelled_appointment_id").references(() => appointments.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  locationId: uuid("location_id").references(() => locations.id),
  type: text("type").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  /** Rounds of texts sent so far; the next goes out when nobody took it (server/waitlist.ts). */
  rounds: integer("rounds").notNull().default(1),
  lastRoundAt: timestamp("last_round_at", { withTimezone: true }),
  filledAt: timestamp("filled_at", { withTimezone: true }),
  filledPatientId: uuid("filled_patient_id").references(() => patients.id),
  filledAppointmentId: uuid("filled_appointment_id").references(() => appointments.id),
});

export const slotOfferRecipients = pgTable("slot_offer_recipients", {
  offerId: uuid("offer_id").notNull().references(() => slotOffers.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  waitlistEntryId: uuid("waitlist_entry_id").notNull().references(() => waitlistEntries.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  /** Twilio reported the text did not reach the phone. */
  undeliveredAt: timestamp("undelivered_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.offerId, t.patientId] })]);

/* When something last ran, by name ("tick": the every-five-minutes run from outside). Migration 0051. */
export const heartbeats = pgTable("heartbeats", {
  name: text("name").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

/** CollaboratMD's own invoices to a practice, kept from the platform's Stripe events for the subscription page. */
export const platformInvoices = pgTable("platform_invoices", {
  id: text("id").primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  number: text("number"),
  status: text("status").notNull(),
  amountDueCents: integer("amount_due_cents").notNull(),
  amountPaidCents: integer("amount_paid_cents").notNull(),
  hostedUrl: text("hosted_url"),
  pdfUrl: text("pdf_url"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, (t) => [index("platform_invoices_practice_idx").on(t.practiceId, t.createdAt)]);

/** Backup restore tests, recorded by operators as evidence the backups work. */
export const restoreTests = pgTable("restore_tests", {
  id: uuid("id").defaultRandom().primaryKey(),
  testedAt: timestamp("tested_at", { withTimezone: true }).notNull(),
  target: text("target").notNull(),
  minutes: integer("minutes"),
  result: text("result").notNull(),
  notes: text("notes"),
  recordedBy: text("recorded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Medicare physician fee schedule relative value units (CMS's PPRRVU file), by year. */
export const mpfsRvus = pgTable("mpfs_rvus", {
  year: integer("year").notNull(),
  code: text("code").notNull(),
  modifier: text("modifier").notNull().default(""),
  status: text("status"),
  workRvu: numeric("work_rvu", { mode: "number" }).notNull(),
  peNonFacility: numeric("pe_non_facility", { mode: "number" }).notNull(),
  peFacility: numeric("pe_facility", { mode: "number" }).notNull(),
  mpRvu: numeric("mp_rvu", { mode: "number" }).notNull(),
  /** Multiple procedure indicator: 2 means the standard 100% / 50% reduction for further procedures that day. */
  multProc: text("mult_proc"),
  /** Global surgery days: 000, 010, 090, or XXX/YYY/ZZZ/MMM when the concept does not apply. Migration 0057. */
  globalDays: text("global_days"),
}, (t) => [primaryKey({ columns: [t.year, t.code, t.modifier] })]);

/** Geographic practice cost indices by Medicare locality (CMS's GPCI file), by year. */
export const mpfsLocalities = pgTable("mpfs_localities", {
  year: integer("year").notNull(),
  carrier: text("carrier").notNull(),
  locality: text("locality").notNull(),
  name: text("name").notNull(),
  state: text("state"),
  workGpci: numeric("work_gpci", { mode: "number" }).notNull(),
  peGpci: numeric("pe_gpci", { mode: "number" }).notNull(),
  mpGpci: numeric("mp_gpci", { mode: "number" }).notNull(),
}, (t) => [primaryKey({ columns: [t.year, t.carrier, t.locality] })]);

/** Each year's conversion factor. */
export const mpfsYears = pgTable("mpfs_years", {
  year: integer("year").primaryKey(),
  conversionFactor: numeric("conversion_factor", { mode: "number" }).notNull(),
});

/** Anesthesia base units by code (CMS's anesthesia base unit file). */
export const anesthesiaBaseUnits = pgTable("anesthesia_base_units", {
  code: text("code").primaryKey(),
  baseUnits: integer("base_units").notNull(),
});

/** Medicare Secondary Payer questions asked of a patient on Medicare, and who pays first as a result. */
export const mspScreenings = pgTable("msp_screenings", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  answers: jsonb("answers").$type<Record<string, boolean>>().notNull(),
  medicarePrimary: boolean("medicare_primary").notNull(),
  mspType: text("msp_type"),
  screenedAt: timestamp("screened_at", { withTimezone: true }).defaultNow().notNull(),
  screenedBy: uuid("screened_by").references(() => users.id),
}, (t) => [index("msp_screenings_patient_idx").on(t.patientId, t.screenedAt)]);

/** Saved column mappings for spreadsheet imports: a practice's own, or shared by the platform (practiceId null). */
export const importPresets = pgTable("import_presets", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").references(() => practices.id),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Passkeys (WebAuthn credentials) people sign in with. */
export const passkeys = pgTable("passkeys", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  publicKey: text("public_key").notNull(),
  algorithm: integer("algorithm").notNull(),
  signCount: integer("sign_count").notNull().default(0),
  transports: jsonb("transports").$type<string[]>(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [index("passkeys_user_idx").on(t.userId)]);

/** One-time WebAuthn challenges, each good for five minutes. */
export const passkeyChallenges = pgTable("passkey_challenges", {
  id: uuid("id").defaultRandom().primaryKey(),
  challenge: text("challenge").notNull(),
  userId: uuid("user_id").references(() => users.id),
  purpose: text("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Quality measures a practice reports on claims (MIPS), as it defines them from CMS's specifications. */
export const qualityMeasures = pgTable("quality_measures", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  number: text("number").notNull(),
  title: text("title").notNull(),
  eligibleCodes: jsonb("eligible_codes").$type<string[]>().notNull(),
  dxPrefixes: jsonb("dx_prefixes").$type<string[]>().notNull().default([]),
  minAge: integer("min_age"),
  maxAge: integer("max_age"),
  codes: jsonb("codes").$type<{ code: string; outcome: "met" | "not_met" | "excluded"; label: string }[]>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("quality_measures_practice_idx").on(t.practiceId)]);

/** Provider-level adjustments in an 835 (PLB): money a payer takes back for other claims, interest, and balances carried forward. */
export const remittanceAdjustments = pgTable("remittance_adjustments", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  remittanceId: uuid("remittance_id").notNull().references(() => remittances.id),
  reason: text("reason").notNull(),
  reference: text("reference"),
  amountCents: integer("amount_cents").notNull(),
  claimId: uuid("claim_id").references(() => claims.id),
  posted: boolean("posted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("remittance_adjustments_remit_idx").on(t.remittanceId), index("remittance_adjustments_claim_idx").on(t.claimId)]);

/** Each level of an appeal: filed, due, and what the payer decided. */
export const appealLevels = pgTable("appeal_levels", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  denialId: uuid("denial_id").notNull().references(() => denials.id),
  level: integer("level").notNull(),
  name: text("name").notNull(),
  dueOn: date("due_on"),
  filedOn: date("filed_on"),
  decision: text("decision"),
  decidedOn: date("decided_on"),
  letterId: uuid("letter_id").references(() => appealLetters.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("appeal_levels_denial_idx").on(t.denialId)]);

/** Advance Beneficiary Notices: a Medicare patient told in writing that Medicare may not pay, and their choice. */
export const abns = pgTable("abns", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  serviceDate: date("service_date").notNull(),
  services: jsonb("services").$type<{ code: string; description: string; estimatedCents: number }[]>().notNull(),
  reason: text("reason").notNull(),
  option: integer("option"),
  signedOn: date("signed_on"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("abns_patient_idx").on(t.patientId, t.serviceDate)]);

/** When an insurance overpayment on a claim was identified: the 60-day refund clock for Medicare and Medicaid starts here. */
export const overpaymentIdentifications = pgTable("overpayment_identifications", {
  claimId: uuid("claim_id").primaryKey().references(() => claims.id),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  identifiedOn: date("identified_on").notNull(),
  identifiedBy: uuid("identified_by").references(() => users.id),
});

/** CMS's list of Medicare telehealth services, by year. */
export const medicareTelehealthCodes = pgTable("medicare_telehealth_codes", {
  year: integer("year").notNull(),
  code: text("code").notNull(),
  status: text("status"),
}, (t) => [primaryKey({ columns: [t.year, t.code] })]);

/* ------------------------------------------------------------------ */
/* Round K: monthly care programs, records requests, prompt pay         */
/* ------------------------------------------------------------------ */

/** A patient's consent to a monthly care program (CCM, BHI, RPM), which Medicare requires before billing it. */
export const careProgramConsents = pgTable("care_program_consents", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  program: text("program").notNull(),
  consentedOn: date("consented_on").notNull(),
  recordedBy: uuid("recorded_by").references(() => users.id),
}, (t) => [primaryKey({ columns: [t.patientId, t.program] })]);

/** Minutes spent on a patient in a monthly care program, billed once the month's time is reached. */
export const careMinutes = pgTable("care_minutes", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  program: text("program").notNull(),
  /** Calendar month, YYYY-MM. */
  month: text("month").notNull(),
  performedOn: date("performed_on").notNull(),
  minutes: integer("minutes").notNull(),
  note: text("note"),
  loggedBy: uuid("logged_by").references(() => users.id),
  claimId: uuid("claim_id").references(() => claims.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("care_minutes_patient_idx").on(t.patientId, t.program, t.month)]);

/** A payer's request for medical records: an additional documentation request, a RAC or commercial audit. */
export const recordsRequests = pgTable("records_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").references(() => patients.id),
  claimId: uuid("claim_id").references(() => claims.id),
  payerId: uuid("payer_id").references(() => payers.id),
  kind: text("kind").notNull(), // adr | rac | tpe | commercial_audit | other
  reference: text("reference"),
  receivedOn: date("received_on").notNull(),
  dueOn: date("due_on").notNull(),
  status: text("status").notNull().default("open"), // open | sent | closed
  sentOn: date("sent_on"),
  sentVia: text("sent_via"),
  outcome: text("outcome"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("records_requests_practice_idx").on(t.practiceId, t.status, t.dueOn)]);

/** A state's prompt-pay statute as the practice reads it: days a commercial payer has to pay a clean claim, and the interest after. */
export const promptPayRules = pgTable("prompt_pay_rules", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  state: text("state").notNull(),
  days: integer("days").notNull(),
  annualRatePct: numeric("annual_rate_pct", { mode: "number" }).notNull(),
  citation: text("citation"),
}, (t) => [primaryKey({ columns: [t.practiceId, t.state] })]);

/** Interest asked of a payer for a late claim, so it is asked for once. */
export const promptPayRequests = pgTable("prompt_pay_requests", {
  claimId: uuid("claim_id").primaryKey().references(() => claims.id),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  daysLate: integer("days_late").notNull(),
  interestCents: integer("interest_cents").notNull(),
  requestedOn: date("requested_on").notNull(),
  receivedCents: integer("received_cents"),
});

/* ------------------------------------------------------------------ */
/* Round L: No Surprises Act disputes, sliding fee scale                */
/* ------------------------------------------------------------------ */

/** An out-of-network payment disputed under the No Surprises Act: open negotiation, then federal IDR. */
export const nsaDisputes = pgTable("nsa_disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  /** When the initial payment or notice of denial arrived; open negotiation must start within 30 business days. */
  initialResponseOn: date("initial_response_on").notNull(),
  offerCents: integer("offer_cents"),
  negotiationStartedOn: date("negotiation_started_on"),
  idrInitiatedOn: date("idr_initiated_on"),
  status: text("status").notNull().default("open"), // open | negotiating | idr | settled | closed
  outcome: text("outcome"),
  settledCents: integer("settled_cents"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("nsa_disputes_practice_idx").on(t.practiceId, t.status)]);

/** The HHS poverty guidelines for a year, as the practice enters them. */
export const povertyGuidelines = pgTable("poverty_guidelines", {
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  year: integer("year").notNull(),
  /** Household of one, and each additional person. */
  baseCents: integer("base_cents").notNull(),
  perPersonCents: integer("per_person_cents").notNull(),
}, (t) => [primaryKey({ columns: [t.practiceId, t.year] })]);

/** Sliding fee discount tiers: households at or below maxPercent of the poverty guideline get the discount. */
export const slidingFeeTiers = pgTable("sliding_fee_tiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  maxPercent: integer("max_percent").notNull(),
  discountPercent: integer("discount_percent").notNull(),
  label: text("label"),
});

/** A patient's verified sliding fee eligibility. */
export const patientSlidingFees = pgTable("patient_sliding_fees", {
  patientId: uuid("patient_id").primaryKey().references(() => patients.id),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  householdSize: integer("household_size").notNull(),
  annualIncomeCents: integer("annual_income_cents").notNull(),
  percentOfPoverty: integer("percent_of_poverty").notNull(),
  discountPercent: integer("discount_percent").notNull(),
  proof: text("proof").notNull(),
  verifiedOn: date("verified_on").notNull(),
  expiresOn: date("expires_on").notNull(),
  recordedBy: uuid("recorded_by").references(() => users.id),
});

/* ------------------------------------------------------------------ */
/* Round M: card on file, HCC mappings, payer refund demands            */
/* ------------------------------------------------------------------ */

/** A charge to a card on file, announced to the patient before it is made. */
export const cardChargeNotices = pgTable("card_charge_notices", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  cardId: uuid("card_id").notNull().references(() => savedCards.id),
  amountCents: integer("amount_cents").notNull(),
  noticeOn: date("notice_on").notNull(),
  chargeOn: date("charge_on").notNull(),
  status: text("status").notNull().default("pending"), // pending | charged | skipped | failed
  detail: text("detail"),
  onlinePaymentId: uuid("online_payment_id").references(() => onlinePayments.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("card_charge_notices_patient_idx").on(t.patientId, t.status)]);

/** CMS's ICD-10-CM to HCC mapping (risk adjustment model), by payment year. */
export const hccMappings = pgTable("hcc_mappings", {
  year: integer("year").notNull(),
  icd10: text("icd10").notNull(),
  hcc: text("hcc").notNull(),
  label: text("label"),
}, (t) => [primaryKey({ columns: [t.year, t.icd10, t.hcc] })]);

/** A payer's written demand for a refund of an overpayment, with its dispute and offset dates. */
export const payerRefundDemands = pgTable("payer_refund_demands", {
  id: uuid("id").defaultRandom().primaryKey(),
  practiceId: uuid("practice_id").notNull().references(() => practices.id),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  payerId: uuid("payer_id").notNull().references(() => payers.id),
  amountCents: integer("amount_cents").notNull(),
  reference: text("reference"),
  receivedOn: date("received_on").notNull(),
  disputeBy: date("dispute_by"),
  offsetOn: date("offset_on"),
  status: text("status").notNull().default("open"), // open | agreed | disputed | offset | closed
  refundId: uuid("refund_id").references(() => refunds.id),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("payer_refund_demands_practice_idx").on(t.practiceId, t.status)]);
