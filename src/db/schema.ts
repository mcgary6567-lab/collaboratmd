import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
  response: jsonb("response").$type<Record<string, unknown>>(),
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
    // charge | insurance_payment | patient_payment | adjustment | write_off | transfer_to_patient | refund | reversal
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

export type ContactMessage = typeof contactMessages.$inferSelect;
export type FeeSchedule = typeof feeSchedules.$inferSelect;
export type Underpayment = typeof underpayments.$inferSelect;
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
