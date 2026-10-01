/**
 * Database migrations, applied in order and recorded in the _migrations table.
 *
 * GENERATED FILE - do not edit by hand.
 * Source: src/db/migrations/*.sql   Regenerate: npm run build:migrations
 *
 * These are compiled into the bundle rather than read from disk at runtime so
 * they are available on serverless platforms, which deploy only the build
 * output and not the source tree.
 */
export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "0000_init",
    sql: `CREATE TABLE IF NOT EXISTS practices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tax_id text NOT NULL,
  npi text NOT NULL,
  address1 text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  email text NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'biller',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  npi text NOT NULL,
  taxonomy text NOT NULL,
  specialty text NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS payers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  payer_id text NOT NULL,
  type text NOT NULL DEFAULT 'commercial',
  timely_filing_days integer NOT NULL DEFAULT 90,
  appeal_days integer NOT NULL DEFAULT 60
);

CREATE TABLE IF NOT EXISTS patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  mrn text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob date NOT NULL,
  sex text NOT NULL,
  phone text,
  email text,
  address1 text,
  city text,
  state text,
  zip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS patients_mrn_idx ON patients(practice_id, mrn);
CREATE INDEX IF NOT EXISTS patients_name_idx ON patients(last_name, first_name);

CREATE TABLE IF NOT EXISTS patient_insurances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  member_id text NOT NULL,
  group_number text,
  rank integer NOT NULL DEFAULT 1,
  relationship text NOT NULL DEFAULT 'self',
  copay_cents integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS eligibility_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_insurance_id uuid NOT NULL REFERENCES patient_insurances(id),
  status text NOT NULL,
  plan_name text,
  copay_cents integer,
  deductible_cents integer,
  deductible_remaining_cents integer,
  oop_max_cents integer,
  response jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  type text NOT NULL DEFAULT 'office_visit',
  status text NOT NULL DEFAULT 'scheduled',
  reason text
);
CREATE INDEX IF NOT EXISTS appointments_start_idx ON appointments(practice_id, starts_at);

CREATE TABLE IF NOT EXISTS encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  appointment_id uuid REFERENCES appointments(id),
  date_of_service date NOT NULL,
  place_of_service text NOT NULL DEFAULT '11',
  diagnoses jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  line_number integer NOT NULL,
  cpt text NOT NULL,
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  units integer NOT NULL DEFAULT 1,
  charge_cents integer NOT NULL,
  dx_pointers jsonb NOT NULL DEFAULT '[1]'::jsonb,
  description text
);

CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  patient_insurance_id uuid NOT NULL REFERENCES patient_insurances(id),
  control_number text NOT NULL,
  payer_claim_number text,
  frequency_code text NOT NULL DEFAULT '1',
  status text NOT NULL DEFAULT 'draft',
  total_cents integer NOT NULL,
  scrub_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  edi_837 text,
  submitted_at timestamptz,
  timely_filing_deadline date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS claims_control_idx ON claims(practice_id, control_number);
CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(practice_id, status);

CREATE TABLE IF NOT EXISTS claim_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id),
  status text NOT NULL,
  source text NOT NULL,
  message text,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  payer_id uuid REFERENCES payers(id),
  payer_name text NOT NULL,
  check_number text NOT NULL,
  amount_cents integer NOT NULL,
  payment_date date NOT NULL,
  raw_835 text NOT NULL,
  posted boolean NOT NULL DEFAULT false,
  posting_summary jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  claim_id uuid REFERENCES claims(id),
  charge_id uuid REFERENCES charges(id),
  remittance_id uuid REFERENCES remittances(id),
  type text NOT NULL,
  amount_cents integer NOT NULL,
  group_code text,
  reason_code text,
  remark_code text,
  note text,
  posted_by uuid REFERENCES users(id),
  posted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_claim_idx ON ledger_entries(claim_id);
CREATE INDEX IF NOT EXISTS ledger_patient_idx ON ledger_entries(patient_id);

CREATE TABLE IF NOT EXISTS denials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  category text NOT NULL,
  carc text NOT NULL,
  rarc text,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES users(id),
  explanation text,
  next_steps jsonb,
  appeal_deadline date,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS cpt_codes (
  code text PRIMARY KEY,
  description text NOT NULL,
  default_fee_cents integer NOT NULL
);

CREATE TABLE IF NOT EXISTS icd10_codes (
  code text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid REFERENCES practices(id),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  details jsonb,
  at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: "0001_scale_indexes",
    sql: `-- Indexes for practice-scale data (hundreds of thousands of claims).
-- Postgres does not index foreign keys automatically, and the dashboards
-- aggregate the ledger by type and posting date.

CREATE INDEX IF NOT EXISTS ledger_practice_type_posted_idx ON ledger_entries (practice_id, type, posted_at);
CREATE INDEX IF NOT EXISTS ledger_practice_posted_idx ON ledger_entries (practice_id, posted_at);

CREATE INDEX IF NOT EXISTS claims_practice_created_idx ON claims (practice_id, created_at);
CREATE INDEX IF NOT EXISTS claims_payer_idx ON claims (payer_id);
CREATE INDEX IF NOT EXISTS claims_encounter_idx ON claims (encounter_id);
CREATE INDEX IF NOT EXISTS claims_patient_idx ON claims (patient_id);

CREATE INDEX IF NOT EXISTS charges_encounter_idx ON charges (encounter_id);

CREATE INDEX IF NOT EXISTS encounters_practice_dos_idx ON encounters (practice_id, date_of_service);
CREATE INDEX IF NOT EXISTS encounters_provider_idx ON encounters (provider_id);
CREATE INDEX IF NOT EXISTS encounters_patient_idx ON encounters (patient_id);

CREATE INDEX IF NOT EXISTS claim_events_claim_idx ON claim_events (claim_id, at);

CREATE INDEX IF NOT EXISTS denials_practice_status_idx ON denials (practice_id, status);
CREATE INDEX IF NOT EXISTS denials_assigned_idx ON denials (assigned_to, status);
CREATE INDEX IF NOT EXISTS denials_practice_created_idx ON denials (practice_id, created_at);

CREATE INDEX IF NOT EXISTS patient_insurances_patient_idx ON patient_insurances (patient_id);
`,
  },
  {
    name: "0002_contact_messages",
    sql: `-- Inbound messages from the public contact form.
--
-- Deliberately outside the practice tenancy: these arrive from visitors who
-- have no account and belong to no practice, so there is no practice_id to
-- scope them by and no foreign key to hang them on.
CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  organization text,
  topic text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_messages_received_idx
  ON contact_messages (received_at DESC);

CREATE INDEX IF NOT EXISTS contact_messages_topic_idx
  ON contact_messages (topic, received_at DESC);
`,
  },
  {
    name: "0003_contact_intake",
    sql: `-- Extra intake on the contact form.
--
-- Investor submissions carry qualifying detail the generic form has no place
-- for, and every submission carries where it came from so an outbound campaign
-- can be measured. All nullable: a support request fills none of them.
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS fund text;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS check_size text;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS source jsonb;

CREATE INDEX IF NOT EXISTS contact_messages_source_campaign_idx
  ON contact_messages ((source ->> 'utm_campaign'));
`,
  },
  {
    name: "0004_fee_schedules",
    sql: `-- Fee schedules and underpayment detection.
--
-- A schedule with no payer is the practice's standard charge master: what it
-- bills. A schedule with a payer holds that payer's contracted allowed
-- amounts: what the contract says it should be paid. Comparing the second
-- against what a remittance actually allowed is how underpayments are found.
CREATE TABLE IF NOT EXISTS fee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  payer_id uuid REFERENCES payers(id),
  name text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One active schedule per payer, and one active standard schedule per practice.
-- NULLs are distinct in a plain unique index, so the standard schedule is keyed
-- on a sentinel.
CREATE UNIQUE INDEX IF NOT EXISTS fee_schedules_active_idx
  ON fee_schedules (practice_id, COALESCE(payer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active;

CREATE TABLE IF NOT EXISTS fee_schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_schedule_id uuid NOT NULL REFERENCES fee_schedules(id) ON DELETE CASCADE,
  cpt text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  UNIQUE (fee_schedule_id, cpt)
);

CREATE TABLE IF NOT EXISTS underpayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  remittance_id uuid REFERENCES remittances(id),
  expected_allowed_cents integer NOT NULL,
  actual_allowed_cents integer NOT NULL,
  variance_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  note text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS underpayments_claim_idx ON underpayments (claim_id);
CREATE INDEX IF NOT EXISTS underpayments_status_idx ON underpayments (practice_id, status);
`,
  },
  {
    name: "0005_patient_billing",
    sql: `-- Patient financial responsibility: discounts, payment plans, statements and
-- estimates.
--
-- A discount is posted to the ledger as its own entry type rather than as an
-- edit to a balance, so the append-only money trail still explains every cent.

CREATE TABLE IF NOT EXISTS discount_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  kind text NOT NULL,                       -- self_pay | prompt_pay | hardship | courtesy
  percent numeric(5,2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discount_policies_practice_idx ON discount_policies (practice_id);

CREATE TABLE IF NOT EXISTS payment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  total_cents integer NOT NULL CHECK (total_cents > 0),
  installment_count integer NOT NULL CHECK (installment_count BETWEEN 2 AND 60),
  frequency text NOT NULL DEFAULT 'monthly',  -- monthly | biweekly
  start_date date NOT NULL,
  status text NOT NULL DEFAULT 'active',      -- active | completed | cancelled | defaulted
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_plans_patient_idx ON payment_plans (patient_id);
CREATE INDEX IF NOT EXISTS payment_plans_status_idx ON payment_plans (practice_id, status);

CREATE TABLE IF NOT EXISTS payment_plan_installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES payment_plans(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  due_date date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  paid_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled',   -- scheduled | partial | paid | missed
  paid_at timestamptz,
  UNIQUE (plan_id, seq)
);

CREATE TABLE IF NOT EXISTS statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  statement_number text NOT NULL,
  statement_date date NOT NULL,
  due_date date NOT NULL,
  charges_cents integer NOT NULL,
  insurance_paid_cents integer NOT NULL,
  adjustments_cents integer NOT NULL,
  patient_paid_cents integer NOT NULL,
  amount_due_cents integer NOT NULL,
  detail jsonb NOT NULL,
  status text NOT NULL DEFAULT 'generated',   -- generated | sent | void
  channel text,                               -- print | email
  sent_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, statement_number)
);
CREATE INDEX IF NOT EXISTS statements_patient_idx ON statements (patient_id, statement_date DESC);

CREATE TABLE IF NOT EXISTS estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  patient_insurance_id uuid REFERENCES patient_insurances(id),
  estimate_number text NOT NULL,
  kind text NOT NULL,                         -- insured | good_faith
  service_date date,
  lines jsonb NOT NULL,
  total_charge_cents integer NOT NULL,
  allowed_cents integer NOT NULL,
  insurance_pays_cents integer NOT NULL,
  patient_owes_cents integer NOT NULL,
  basis jsonb NOT NULL,
  valid_until date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, estimate_number)
);
CREATE INDEX IF NOT EXISTS estimates_patient_idx ON estimates (patient_id, created_at DESC);

-- Benefit detail an estimate needs and the eligibility response already carries.
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS coinsurance_pct numeric(5,2);
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS oop_remaining_cents integer;
`,
  },
  {
    name: "0006_claim_controls",
    sql: `-- Claim controls: replacement and void references, clearinghouse
-- acknowledgments, payer-specific edits and prior authorizations.

-- A corrected (frequency 7) or void (frequency 8) claim must carry the payer's
-- claim control number for the claim it replaces, in REF*F8, or the payer
-- rejects it. Keep the link and the number that was sent.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS original_claim_id uuid REFERENCES claims(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS original_payer_claim_number text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS authorization_number text;

-- 999 (syntax) and 277CA (claim-level) acknowledgments as received.
CREATE TABLE IF NOT EXISTS claim_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id),
  kind text NOT NULL,                 -- 999 | 277CA
  accepted boolean NOT NULL,
  code text,                          -- IK5/AK9 code, or STC category:status
  message text,
  raw text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_acknowledgments_claim_idx ON claim_acknowledgments (claim_id, received_at);

-- Payer-specific edits, evaluated alongside the general scrubber. A null
-- payer applies to every payer; a null code applies to every line.
CREATE TABLE IF NOT EXISTS payer_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  payer_id uuid REFERENCES payers(id),
  kind text NOT NULL,                 -- auth_required | modifier_required | dx_required | max_units | not_covered
  cpt text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'error',
  message text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payer_edits_lookup_idx ON payer_edits (practice_id, payer_id) WHERE active;

-- Prior authorizations on file, so a claim that needs one can be checked
-- before it is sent rather than denied with CARC 197 weeks later.
CREATE TABLE IF NOT EXISTS authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  auth_number text NOT NULL,
  cpts jsonb NOT NULL DEFAULT '[]'::jsonb,
  units_approved integer,
  units_used integer NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active | cancelled
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS authorizations_patient_idx ON authorizations (patient_id, payer_id);
`,
  },
  {
    name: "0007_eligibility_x12",
    sql: `-- Eligibility checks keep the 270 that was sent and the 271 that came back,
-- so a disputed benefit can be traced to exactly what the payer said.
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS service_date date;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS trace_number text;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS request_270 text;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS response_271 text;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS message text;
CREATE INDEX IF NOT EXISTS eligibility_checks_insurance_idx ON eligibility_checks (patient_insurance_id, checked_at DESC);
`,
  },
  {
    name: "0008_digital_checkin",
    sql: `-- Digital check-in: a link sent to the patient before the visit. The token
-- itself is never stored, only its SHA-256, so a database read does not yield
-- working links. Opening the link shows nothing about the patient until the
-- date of birth is confirmed, and repeated wrong answers lock it.
CREATE TABLE IF NOT EXISTS checkin_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  verified_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_links_appointment_idx ON checkin_links (appointment_id);

-- What the patient submitted. Changes are held for staff review rather than
-- written straight into the chart.
CREATE TABLE IF NOT EXISTS checkin_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  link_id uuid NOT NULL REFERENCES checkin_links(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  demographics jsonb NOT NULL,
  insurance jsonb NOT NULL,
  consents jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | applied | dismissed
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_submissions_pending_idx ON checkin_submissions (practice_id, status, created_at);
`,
  },
  {
    name: "0009_practice_memberships",
    sql: `-- A billing company works for many practices with one login. A membership
-- grants a user access to a practice with a role for that practice; the
-- user's own practice_id stays as the practice they land in after login.
CREATE TABLE IF NOT EXISTS practice_memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id),
  role text NOT NULL,                  -- admin | biller | front_desk | readonly
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, practice_id)
);
CREATE INDEX IF NOT EXISTS practice_memberships_practice_idx ON practice_memberships (practice_id);

-- Everyone already has access to their own practice.
INSERT INTO practice_memberships (user_id, practice_id, role)
SELECT id, practice_id, role FROM users
ON CONFLICT (user_id, practice_id) DO NOTHING;
`,
  },
  {
    name: "0010_integrations",
    sql: `-- Keys an EHR interface engine uses to post HL7 to /api/hl7. Only a hash is
-- kept; the key is shown once, when it is created. The prefix identifies a
-- key in lists without revealing it.
CREATE TABLE IF NOT EXISTS integration_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Every HL7 message received, with what became of it. The control ID makes
-- a resend idempotent: the same message twice is acknowledged, not applied twice.
CREATE TABLE IF NOT EXISTS integration_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  key_id uuid REFERENCES integration_keys(id),
  source text NOT NULL,                -- api | manual
  message_type text NOT NULL,          -- e.g. ADT^A04
  control_id text NOT NULL,
  status text NOT NULL,                -- processed | error | duplicate
  error text,
  result jsonb,
  raw text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_messages_control_idx ON integration_messages (practice_id, control_id) WHERE status = 'processed';
CREATE INDEX IF NOT EXISTS integration_messages_recent_idx ON integration_messages (practice_id, received_at DESC);

-- File imports (patients from another system's export).
CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  kind text NOT NULL,                  -- patients
  filename text NOT NULL,
  mapping jsonb NOT NULL,
  mapped_by text NOT NULL,             -- rules | ai | user
  total_rows integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: "0011_labs",
    sql: `-- Lab orders and their results. The placer order number is ours and unique
-- per practice; a lab echoes it in its result so the result finds its order.
CREATE TABLE IF NOT EXISTS lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  lab_code text NOT NULL,
  placer_order_number text NOT NULL,
  filler_order_number text,
  tests jsonb NOT NULL,                -- [{code, name, cpt}]
  diagnoses jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ordered', -- ordered | partial | resulted | cancelled
  orm_message text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resulted_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS lab_orders_placer_idx ON lab_orders (practice_id, placer_order_number);
CREATE INDEX IF NOT EXISTS lab_orders_patient_idx ON lab_orders (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lab_orders_open_idx ON lab_orders (practice_id, status);

CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES lab_orders(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  test_code text NOT NULL,
  loinc text NOT NULL,
  name text NOT NULL,
  value text NOT NULL,
  units text,
  reference_range text,
  flag text,                           -- HL7 0078: L, H, LL, HH, A, N
  status text NOT NULL DEFAULT 'F',    -- F final, P preliminary, C corrected
  observed_at date,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lab_results_order_idx ON lab_results (order_id);
`,
  },
  {
    name: "0012_secondary_claims",
    sql: `-- Secondary billing. A claim to the patient's second insurer carries the
-- first insurer's adjudication (payer sequence S) and points at the primary
-- claim. Money the secondary pays posts to the primary claim, so charges are
-- counted once and the balance stays on one claim.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_sequence text NOT NULL DEFAULT 'P';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS primary_claim_id uuid REFERENCES claims(id);
CREATE INDEX IF NOT EXISTS claims_primary_idx ON claims (primary_claim_id) WHERE primary_claim_id IS NOT NULL;
`,
  },
  {
    name: "0013_claim_status",
    sql: `-- Claim status inquiries (276) and the payer's answers (277), kept per claim
-- so follow-up shows what the payer said and when it was last asked.
CREATE TABLE IF NOT EXISTS claim_status_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  category text,
  status_code text,
  entity text,
  message text,
  paid_cents integer,
  next_action text,
  request_276 text,
  response_277 text,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_status_checks_claim_idx ON claim_status_checks (claim_id, checked_at DESC);
`,
  },
  {
    name: "0014_mfa",
    sql: `-- Two-factor sign-in with an authenticator app. The secret is stored
-- encrypted with a key derived from AUTH_SECRET; recovery codes only as
-- SHA-256 hashes. The last accepted time step stops a code being replayed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step bigint;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Repeated wrong passwords or codes lock the account for a while.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
-- A practice can require two-factor for everyone who works in it.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;
`,
  },
  {
    name: "0015_tasks_notes_views",
    sql: `-- Work assignment: a task can point at a claim, denial or patient, has an
-- assignee and a due date, and is closed when done.
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  title text NOT NULL,
  entity_type text,                    -- claim | denial | patient
  entity_id uuid,
  assignee_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  due_date date,
  priority text NOT NULL DEFAULT 'normal', -- normal | high
  status text NOT NULL DEFAULT 'open',     -- open | done
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_practice_idx ON tasks (practice_id, status);
CREATE INDEX IF NOT EXISTS tasks_entity_idx ON tasks (entity_type, entity_id);

-- Free-text notes on a claim, denial or patient, shown on its timeline.
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  user_id uuid REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_entity_idx ON notes (entity_type, entity_id, created_at DESC);

-- A user's named filters on a list page.
CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id),
  page text NOT NULL,                  -- claims | patients | denials
  name text NOT NULL,
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_views_user_idx ON saved_views (user_id, page);
`,
  },
  {
    name: "0016_portal_payments",
    sql: `-- Patient portal links. Like check-in links: a random token stored only as
-- a hash, date-of-birth verification, and a lock after repeated failures.
CREATE TABLE IF NOT EXISTS portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'portal', -- portal | pay
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_links_patient_idx ON portal_links (patient_id);

-- Online card payments through a processor (Stripe). The ledger entry is
-- posted once, when the processor confirms the payment.
CREATE TABLE IF NOT EXISTS online_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  plan_id uuid REFERENCES payment_plans(id),
  provider text NOT NULL DEFAULT 'stripe',
  provider_ref text,                   -- checkout session or payment intent id
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending', -- pending | paid | failed | expired
  source text NOT NULL,                -- portal | autopay
  ledger_entry_id uuid,
  failure text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS online_payments_ref_idx ON online_payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS online_payments_patient_idx ON online_payments (patient_id, created_at DESC);

-- A card saved with the processor for automatic plan installments. Only the
-- processor references and display details are kept, never card numbers.
CREATE TABLE IF NOT EXISTS saved_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  provider_customer text NOT NULL,
  provider_method text NOT NULL,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  autopay_plan_id uuid REFERENCES payment_plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS saved_cards_patient_idx ON saved_cards (patient_id) WHERE removed_at IS NULL;

-- Consent to be texted (TCPA) and to receive reminders, per patient.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS reminders_opt_out boolean NOT NULL DEFAULT false;

-- Every text and email sent to a patient, with its outcome.
CREATE TABLE IF NOT EXISTS message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid REFERENCES patients(id),
  channel text NOT NULL,               -- sms | email
  kind text NOT NULL,                  -- appointment_reminder | balance_reminder | pay_link | portal_link | report
  recipient text NOT NULL,
  entity_id uuid,                      -- appointment, statement or plan the message is about
  status text NOT NULL,                -- sent | failed | skipped
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_log_kind_idx ON message_log (practice_id, kind, entity_id);
`,
  },
  {
    name: "0017_automation",
    sql: `-- What the daily job does for each practice. Every switch starts off, so
-- nothing is sent to patients until a practice turns it on.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS automation jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One row per practice per run of the daily job, with what it did.
CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  ran_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL,
  error text
);
CREATE INDEX IF NOT EXISTS automation_runs_practice_idx ON automation_runs (practice_id, ran_at DESC);
`,
  },
  {
    name: "0018_appeals_deposits_enrollment_collections",
    sql: `-- Appeal letters drafted for denials: kept as edited, and when sent.
CREATE TABLE IF NOT EXISTS appeal_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  denial_id uuid NOT NULL REFERENCES denials(id),
  body text NOT NULL,
  source text NOT NULL,                -- ai | template
  status text NOT NULL DEFAULT 'draft',-- draft | sent
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS appeal_letters_denial_idx ON appeal_letters (denial_id);

-- Bank deposits imported from the bank's export, matched to remittances.
CREATE TABLE IF NOT EXISTS bank_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  deposit_date date NOT NULL,
  amount_cents integer NOT NULL,
  description text NOT NULL,
  remittance_id uuid REFERENCES remittances(id),
  status text NOT NULL DEFAULT 'unmatched', -- unmatched | matched | ignored
  match_reason text,
  fingerprint text NOT NULL,           -- date|amount|description, so a re-import adds nothing twice
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_deposits_fingerprint_idx ON bank_deposits (practice_id, fingerprint);

-- Which payer each provider is enrolled with, and when that lapses.
CREATE TABLE IF NOT EXISTS provider_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  status text NOT NULL DEFAULT 'not_started', -- not_started | submitted | in_process | approved | denied | terminated
  payer_provider_id text,
  submitted_on date,
  effective_on date,
  revalidation_due date,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_enrollments_pair_idx ON provider_enrollments (provider_id, payer_id);

-- Patient accounts past normal statements: final notice, then an agency.
CREATE TABLE IF NOT EXISTS patient_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  stage text NOT NULL,                 -- final_notice | agency | recalled | settled
  amount_cents integer NOT NULL,
  agency text,
  final_notice_at timestamptz,
  placed_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_collections_patient_idx ON patient_collections (patient_id, created_at DESC);
`,
  },
  {
    name: "0019_practice_integrations",
    sql: `-- Outside services a practice connects from the admin screen: clearinghouse,
-- card payments, texting, email and AI. Secrets are encrypted by the
-- application (AES-256-GCM) before they reach this table; settings that are
-- not secret (a from-number, a sender address) are kept readable.
CREATE TABLE IF NOT EXISTS practice_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider text NOT NULL,              -- stedi | stripe | twilio | resend | anthropic
  enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets text,                        -- sealed JSON of the provider's secret fields
  secret_hints jsonb NOT NULL DEFAULT '{}'::jsonb, -- last four characters, for display only
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_integrations_provider_idx ON practice_integrations (practice_id, provider);
`,
  },
  {
    name: "0020_public_api_webhooks",
    sql: `-- Keys for the public REST API (/api/v1). Only a SHA-256 hash is kept; the
-- key itself is shown once, when it is created.
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'read', -- read | write (write includes read)
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_practice_idx ON api_keys (practice_id);

-- Where a practice wants events sent. The signing secret is sealed by the
-- application because it is needed in the clear to sign each delivery.
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  url text NOT NULL,
  description text,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  secret text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_practice_idx ON webhook_endpoints (practice_id);

-- One row per event per endpoint, retried with backoff until delivered or
-- given up on.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | delivered | failed
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx ON webhook_deliveries (endpoint_id, created_at DESC);
`,
  },
  {
    name: "0021_denial_agent",
    sql: `-- What the denial agent prepared for each denial, waiting for a person to
-- approve or dismiss. One proposal per denial.
CREATE TABLE IF NOT EXISTS denial_agent_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  denial_id uuid NOT NULL UNIQUE REFERENCES denials(id),
  action text NOT NULL,          -- appeal | correct_claim | write_off | update_insurance
  title text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  letter_id uuid REFERENCES appeal_letters(id),
  result_claim_id uuid REFERENCES claims(id),
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed', -- proposed | approved | dismissed
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS denial_agent_items_queue_idx ON denial_agent_items (practice_id, status, priority DESC);
`,
  },
  {
    name: "0022_custom_reports",
    sql: `-- Reports built in the report builder, optionally emailed on a schedule.
-- The email carries totals and a sign-in link, never patient rows.
CREATE TABLE IF NOT EXISTS custom_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  dataset text NOT NULL,             -- claims | denials | payments | charges
  config jsonb NOT NULL,             -- columns, group, range, filters
  schedule text NOT NULL DEFAULT 'none', -- none | weekly | monthly
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_sent_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_reports_practice_idx ON custom_reports (practice_id);
`,
  },
  {
    name: "0023_auth_requests",
    sql: `-- Electronic prior authorization requests (X12 278) and the payer's answers.
-- An approval also creates an authorizations row, which claims and the
-- scrubber already use.
CREATE TABLE IF NOT EXISTS auth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  cpts jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnoses jsonb NOT NULL DEFAULT '[]'::jsonb,
  units integer NOT NULL DEFAULT 1,
  service_from date NOT NULL,
  service_to date NOT NULL,
  status text NOT NULL,              -- approved | partial | denied | pended | not_required | cancelled | error
  auth_number text,
  valid_from date,
  valid_to date,
  message text,
  authorization_id uuid REFERENCES authorizations(id),
  request_278 text NOT NULL,
  response_278 text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_requests_patient_idx ON auth_requests (patient_id, created_at DESC);
`,
  },
  {
    name: "0024_institutional_claims",
    sql: `-- Institutional (837I / UB-04) claims alongside professional ones.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_type text NOT NULL DEFAULT 'professional'; -- professional | institutional
-- Type of bill, statement period, admission and discharge details.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS institutional jsonb;
-- Revenue code on facility service lines (the procedure code is optional there).
ALTER TABLE charges ADD COLUMN IF NOT EXISTS revenue_code text;
`,
  },
  {
    name: "0025_compliance",
    sql: `-- Periodic user access reviews: who looked, when, and what they concluded.
CREATE TABLE IF NOT EXISTS access_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  reviewed_by uuid REFERENCES users(id),
  users_reviewed integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_reviews_practice_idx ON access_reviews (practice_id, created_at DESC);

-- Vendors that touch the practice's data, and whether a business associate
-- agreement (BAA) is in place. Recorded by the practice; nothing here is
-- assumed about a vendor's willingness to sign one.
CREATE TABLE IF NOT EXISTS vendor_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  vendor text NOT NULL,
  service text NOT NULL,
  handles_phi boolean NOT NULL DEFAULT true,
  baa_status text NOT NULL DEFAULT 'not_recorded', -- signed | pending | not_needed | not_recorded
  signed_on date,
  notes text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_agreements_vendor_idx ON vendor_agreements (practice_id, vendor);
`,
  },
  {
    name: "0026_code_sets",
    sql: `-- National code-set edits, loaded from CMS's published files by the platform
-- operator. Shared by every practice: the rules are the same for everyone.

-- NCCI procedure-to-procedure edits: column 2 is not paid with column 1 on
-- the same day unless the modifier indicator allows a bypass modifier.
CREATE TABLE IF NOT EXISTS ncci_ptp (
  column1 text NOT NULL,
  column2 text NOT NULL,
  effective date NOT NULL,
  deletion date,
  modifier_indicator text NOT NULL, -- 0 never bypassed, 1 bypass with an NCCI modifier, 9 not applicable
  rationale text,
  PRIMARY KEY (column1, column2, effective)
);
CREATE INDEX IF NOT EXISTS ncci_ptp_column2_idx ON ncci_ptp (column2);

-- Medically unlikely edits: the most units of a code one patient gets on one day.
CREATE TABLE IF NOT EXISTS ncci_mue (
  code text PRIMARY KEY,
  max_units integer NOT NULL,
  adjudication_indicator text, -- 1 line, 2 date of service (policy), 3 date of service (clinical)
  rationale text
);

-- Medicare coverage policies (LCD articles / NCDs): which diagnoses support a procedure.
CREATE TABLE IF NOT EXISTS coverage_policy_codes (
  policy_id text NOT NULL,
  title text NOT NULL,
  cpt text NOT NULL,
  icd10 text NOT NULL,
  PRIMARY KEY (policy_id, cpt, icd10)
);
CREATE INDEX IF NOT EXISTS coverage_policy_codes_cpt_idx ON coverage_policy_codes (cpt);

-- What was loaded, when and by whom.
CREATE TABLE IF NOT EXISTS code_set_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_set text NOT NULL, -- ncci_ptp | ncci_mue | coverage
  label text NOT NULL,
  rows integer NOT NULL,
  loaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Rule suggestions a practice chose not to adopt, so they stop being suggested.
CREATE TABLE IF NOT EXISTS rule_suggestion_dismissals (
  practice_id uuid NOT NULL REFERENCES practices(id),
  suggestion_key text NOT NULL,
  dismissed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, suggestion_key)
);
`,
  },
  {
    name: "0027_recovery",
    sql: `-- Underpayment disputes: the letter sent and what came back.
ALTER TABLE underpayments ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE underpayments ADD COLUMN IF NOT EXISTS recovered_cents integer;

-- Appointments reviewed as not billable, so they stop showing as missed charges.
CREATE TABLE IF NOT EXISTS charge_review_dismissals (
  appointment_id uuid PRIMARY KEY REFERENCES appointments(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  reason text NOT NULL,
  dismissed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Refunds of credit balances: requested, approved, then issued (which posts the ledger entry).
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  claim_id uuid REFERENCES claims(id),
  payee text NOT NULL,              -- patient | payer
  payer_id uuid REFERENCES payers(id),
  amount_cents integer NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested', -- requested | approved | issued | cancelled
  method text,
  reference text,
  ledger_entry_id uuid REFERENCES ledger_entries(id),
  requested_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  issued_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  issued_at timestamptz
);
CREATE INDEX IF NOT EXISTS refunds_practice_idx ON refunds (practice_id, status);
`,
  },
  {
    name: "0028_front_desk",
    sql: `-- Two-way texting: every text in or out, threaded by the patient's number.
CREATE TABLE IF NOT EXISTS sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid REFERENCES patients(id),
  direction text NOT NULL,            -- in | out
  phone text NOT NULL,                -- the patient's number, E.164
  body text NOT NULL,
  twilio_sid text,
  status text NOT NULL DEFAULT 'received', -- received | sent | failed
  read_at timestamptz,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_thread_idx ON sms_messages (practice_id, phone, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_sid_idx ON sms_messages (twilio_sid) WHERE twilio_sid IS NOT NULL;

-- Numbers that replied STOP. Nothing is texted to them until they reply START.
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  practice_id uuid NOT NULL REFERENCES practices(id),
  phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, phone)
);

-- Coverage discovery: eligibility searches by name and date of birth for patients with no insurance on file.
CREATE TABLE IF NOT EXISTS coverage_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  status text NOT NULL,               -- found | not_found | error
  member_id text,
  plan_name text,
  message text,
  added_insurance_id uuid REFERENCES patient_insurances(id),
  checked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coverage_searches_patient_idx ON coverage_searches (practice_id, patient_id, created_at);
`,
  },
  {
    name: "0029_access_control",
    sql: `-- Deactivated users keep their history but cannot sign in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- Practice sign-in policy: how long a session lasts, and where sign-in is allowed from.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS session_hours integer NOT NULL DEFAULT 12;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS ip_allowlist jsonb NOT NULL DEFAULT '[]';

-- Custom roles: a built-in role with some abilities switched off. users.role and
-- practice_memberships.role hold 'custom:<id>' for someone given one.
CREATE TABLE IF NOT EXISTS custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  base_role text NOT NULL,          -- admin | biller | front_desk | readonly
  denied jsonb NOT NULL DEFAULT '[]', -- capability keys switched off
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, name)
);

-- Single sign-on (OpenID Connect) and SCIM provisioning, per practice.
CREATE TABLE IF NOT EXISTS practice_sso (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  issuer text NOT NULL,
  client_id text NOT NULL,
  client_secret_sealed text NOT NULL,
  domains jsonb NOT NULL DEFAULT '[]',   -- email domains that sign in here
  enforce boolean NOT NULL DEFAULT false, -- passwords refused for those domains
  auto_provision boolean NOT NULL DEFAULT false,
  default_role text NOT NULL DEFAULT 'readonly',
  scim_token_hash text,
  scim_token_hint text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: "0030_operations",
    sql: `-- Billing-company invoicing: what a client practice pays for billing services.
CREATE TABLE IF NOT EXISTS client_agreements (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  issuer_name text NOT NULL,
  issuer_address text,
  rate_bps integer NOT NULL,             -- percent of collections, in basis points (650 = 6.5%)
  minimum_cents integer NOT NULL DEFAULT 0,
  include_patient boolean NOT NULL DEFAULT true,
  terms_days integer NOT NULL DEFAULT 30,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  number text NOT NULL,
  period text NOT NULL,                  -- YYYY-MM
  insurance_cents integer NOT NULL,
  patient_cents integer NOT NULL,
  base_cents integer NOT NULL,           -- collections the fee is charged on
  rate_bps integer NOT NULL,
  fee_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',  -- draft | sent | paid | void
  due_date date,
  issuer jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  paid_at timestamptz,
  UNIQUE (practice_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS client_invoices_period_idx ON client_invoices (practice_id, period) WHERE status <> 'void';

-- Accounting: the practice's names for the general-ledger accounts the journal posts to.
CREATE TABLE IF NOT EXISTS accounting_settings (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  accounts jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Month-end close: the month's totals frozen, so later changes to that month show up as a difference.
CREATE TABLE IF NOT EXISTS period_closes (
  practice_id uuid NOT NULL REFERENCES practices(id),
  period text NOT NULL,                  -- YYYY-MM
  totals jsonb NOT NULL,
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, period)
);

-- Work queues: rules that turn denials and stuck claims into assigned tasks with a due date.
CREATE TABLE IF NOT EXISTS work_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  kind text NOT NULL,                    -- denials | stalled_claims | rejections
  conditions jsonb NOT NULL DEFAULT '{}',
  assignee_ids jsonb NOT NULL DEFAULT '[]',
  sla_days integer NOT NULL DEFAULT 5,
  priority text NOT NULL DEFAULT 'normal',
  active boolean NOT NULL DEFAULT true,
  next_index integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rule_id uuid REFERENCES work_rules(id);
`,
  },
  {
    name: "0031_errors_dental_attachments",
    sql: `-- Server errors, grouped: one row per distinct error, counted. Messages are redacted
-- before they are stored and no request headers or query strings are kept.
CREATE TABLE IF NOT EXISTS error_events (
  fingerprint text PRIMARY KEY,
  message text NOT NULL,
  digest text,
  route_path text,
  route_type text,
  method text,
  path text,
  count integer NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS error_events_seen_idx ON error_events (last_seen);

-- Dental service lines (837D): tooth, surfaces and area of the mouth.
ALTER TABLE charges ADD COLUMN IF NOT EXISTS tooth text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS surfaces text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS oral_cavity text;

-- Documents that support a claim, referenced from the claim by a PWK segment.
CREATE TABLE IF NOT EXISTS claim_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  report_type text NOT NULL,       -- PWK01, e.g. OZ support data, RR radiology report, OB operative note
  transmission text NOT NULL,      -- PWK02: FX fax, BM mail, EL electronic, AA available on request
  control_number text NOT NULL,    -- PWK06, the attachment control number the payer matches on
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  data_base64 text NOT NULL,       -- the file, base64 (at most 5 MB before encoding)
  sent_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_attachments_claim_idx ON claim_attachments (claim_id);
`,
  },
  {
    name: "0032_admin_controls",
    sql: `-- Practice policies (billing rules an administrator sets), menu customization,
-- and "sign everyone out": sessions that began before this moment end.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS policies jsonb NOT NULL DEFAULT '{}';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS hidden_nav jsonb NOT NULL DEFAULT '[]';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;
-- One person's sessions, ended by an administrator.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;
`,
  },
  {
    name: "0033_growth",
    sql: `-- Clearinghouse polling: where the last poll stopped, and every inbound transaction seen, so none is imported twice.
CREATE TABLE IF NOT EXISTS clearinghouse_polls (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  cursor text,
  last_polled_at timestamptz,
  last_error text,
  eras_imported integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inbound_transactions (
  practice_id uuid NOT NULL REFERENCES practices(id),
  transaction_id text NOT NULL,
  transaction_set text NOT NULL,
  remittance_id uuid REFERENCES remittances(id),
  note text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, transaction_id)
);

-- Self-service password reset: throttled per account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_sent_at timestamptz;
-- Daily email digest of notifications.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_digest boolean NOT NULL DEFAULT false;

-- In-app notifications. user_id null means every administrator of the practice.
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid REFERENCES users(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (practice_id, user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications (practice_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Onboarding checklist dismissed.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamptz;
-- Patient financing: the practice's own lender and when to offer it.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS financing jsonb;

-- Pre-visit estimates tied to an appointment, with an optional deposit request.
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES appointments(id);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deposit_requested_at timestamptz;

-- Credentialing: licenses, DEA, board certification, malpractice and CAQH attestation per provider.
CREATE TABLE IF NOT EXISTS provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  kind text NOT NULL,          -- state_license | dea | board | malpractice | caqh | other
  identifier text,
  state text,
  issued_on date,
  expires_on date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_credentials_expiry_idx ON provider_credentials (practice_id, expires_on);

-- A/R carried over from the practice's previous billing system, worked here until it is collected or written off.
CREATE TABLE IF NOT EXISTS legacy_ar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_name text,
  source_claim_number text,
  date_of_service date,
  billed_cents integer NOT NULL,
  balance_cents integer NOT NULL,
  responsibility text NOT NULL,  -- insurance | patient
  status text NOT NULL DEFAULT 'open', -- open | collected | written_off
  batch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legacy_ar_practice_idx ON legacy_ar (practice_id, status);

-- FHIR connection to an EHR: patients and finished visits pulled in.
CREATE TABLE IF NOT EXISTS fhir_connections (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  base_url text NOT NULL,
  token_sealed text,
  last_sync_at timestamptz,
  last_result jsonb
);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS fhir_id text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS fhir_id text;
CREATE UNIQUE INDEX IF NOT EXISTS patients_fhir_idx ON patients (practice_id, fhir_id) WHERE fhir_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_fhir_idx ON appointments (practice_id, fhir_id) WHERE fhir_id IS NOT NULL;

-- SAML single sign-on, alongside OpenID Connect.
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'oidc';
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS saml_entry_point text;
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS saml_idp_issuer text;
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS saml_idp_cert text;
ALTER TABLE practice_sso ALTER COLUMN issuer DROP NOT NULL;
ALTER TABLE practice_sso ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE practice_sso ALTER COLUMN client_secret_sealed DROP NOT NULL;
`,
  },
  {
    name: "0034_saml_requests",
    sql: `-- SAML AuthnRequest IDs we issued, so a response is accepted only in reply to one of ours (InResponseTo), once.
CREATE TABLE IF NOT EXISTS saml_requests (
  id text PRIMARY KEY,
  practice_id uuid REFERENCES practices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: "0035_auth_throttle",
    sql: `-- Attempt counters for sign-in, password reset and portal checks, keyed by a hash of the caller's address,
-- so a flood of guesses across many accounts is slowed even though each account has its own lockout.
CREATE TABLE IF NOT EXISTS auth_throttle (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0
);
`,
  },
  {
    name: "0036_ops_alerts",
    sql: `-- Rolling error counts and when each kind of operator alert last went out, so a burst of errors sends one alert, not hundreds.
CREATE TABLE IF NOT EXISTS ops_alerts (
  kind text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz
);
`,
  },
  {
    name: "0037_product_gaps",
    sql: `-- Clearinghouse enrollment per payer and transaction (claims, ERA, EFT, eligibility, claim status).
CREATE TABLE IF NOT EXISTS transaction_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  transaction text NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  submitted_on date,
  approved_on date,
  reference text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, payer_id, transaction)
);

-- SMART backend services (signed-JWT client credentials) for FHIR.
ALTER TABLE fhir_connections ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'token';
ALTER TABLE fhir_connections ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE fhir_connections ADD COLUMN IF NOT EXISTS token_url text;
ALTER TABLE fhir_connections ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE fhir_connections ADD COLUMN IF NOT EXISTS key_id text;
ALTER TABLE fhir_connections ADD COLUMN IF NOT EXISTS private_key_sealed text;
ALTER TABLE fhir_connections ADD COLUMN IF NOT EXISTS public_jwk jsonb;

-- Statements printed and mailed through Lob.
ALTER TABLE statements ADD COLUMN IF NOT EXISTS mail_id text;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS mail_status text;
ALTER TABLE statements ADD COLUMN IF NOT EXISTS mailed_at timestamptz;

-- Card-present payments on a Stripe Terminal reader.
CREATE TABLE IF NOT EXISTS terminal_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  reader_id text NOT NULL,
  payment_intent_id text NOT NULL UNIQUE,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'waiting',
  failure text,
  ledger_entry_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS terminal_payments_practice_idx ON terminal_payments (practice_id, created_at);

-- Contract terms beyond a flat rate: multiple-procedure and modifier reductions.
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS rules jsonb;
ALTER TABLE fee_schedule_items ADD COLUMN IF NOT EXISTS mppr boolean NOT NULL DEFAULT false;

-- Service locations (clinics, facilities) for practices that see patients in more than one place.
CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  npi text,
  address1 text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  place_of_service text NOT NULL DEFAULT '11',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS locations_practice_idx ON locations (practice_id);
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);
`,
  },
  {
    name: "0038_signup_subscriptions",
    sql: `-- Self-serve signups waiting for their email to be confirmed.
CREATE TABLE IF NOT EXISTS signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  practice_name text NOT NULL,
  plan text,
  password_hash text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  practice_id uuid REFERENCES practices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signups_email_idx ON signups (lower(email), created_at);

-- A practice's own subscription to CollaboratMD (not its patients' payments).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS self_serve boolean NOT NULL DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'none';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_subscription_item_id text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS seats integer;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS claims_reported_through timestamptz;
`,
  },
  {
    name: "0039_integration_checks",
    sql: `-- Results of the integration doctor: each check, when it ran, and what it found.
CREATE TABLE IF NOT EXISTS integration_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  check_id text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ran_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS integration_checks_practice_idx ON integration_checks (practice_id, check_id, ran_at DESC);
`,
  },
  {
    name: "0040_file_storage",
    sql: `-- Attachments may live in an external store (see server/files.ts) instead of the row.
ALTER TABLE claim_attachments ALTER COLUMN data_base64 DROP NOT NULL;
ALTER TABLE claim_attachments ADD COLUMN IF NOT EXISTS storage_key text;

-- Full practice exports prepared in the background and kept for a week.
CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  requested_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'queued',
  storage_key text,
  bytes bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS export_jobs_practice_idx ON export_jobs (practice_id, created_at DESC);
`,
  },
  {
    name: "0041_platform_ops",
    sql: `-- Account emails already sent to a practice (welcome, setup nudge, trial ending...), so each goes once.
CREATE TABLE IF NOT EXISTS lifecycle_emails (
  practice_id uuid NOT NULL REFERENCES practices(id),
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, kind)
);

-- Which version of the terms and privacy policy each administrator accepted, and when.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  document text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text
);
CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON legal_acceptances (user_id, document, version);

-- Past-due grace and account closure.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS past_due_since timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS closing_at timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS closing_requested_by uuid;

-- A record that a practice's data was deleted, kept after the practice is gone (no foreign keys on purpose).
CREATE TABLE IF NOT EXISTS practice_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL,
  practice_name text NOT NULL,
  requested_by_email text,
  requested_at timestamptz,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  rows_deleted integer NOT NULL,
  files_deleted integer NOT NULL
);
`,
  },
  {
    name: "0042_ledger_guard",
    sql: `-- Posted money is never edited: corrections post new entries. The application
-- follows that rule; this makes the database enforce it too, so a bug or a
-- stray query cannot rewrite history.
--
-- Allowed: re-linking an entry to a corrected claim or a replaced charge line
-- (claim_id, charge_id), which moves no money; and deleting a practice's
-- entries once its scheduled closure date has passed (Settings > Close account).
-- A database owner can still disable the trigger; this guards the application,
-- not against someone with full database access.
CREATE OR REPLACE FUNCTION ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM practices p WHERE p.id = OLD.practice_id AND p.closing_at IS NOT NULL AND p.closing_at <= now()) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Ledger entries cannot be deleted; post a correcting entry instead';
  END IF;
  IF NEW.practice_id IS NOT DISTINCT FROM OLD.practice_id
     AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
     AND NEW.group_code IS NOT DISTINCT FROM OLD.group_code
     AND NEW.reason_code IS NOT DISTINCT FROM OLD.reason_code
     AND NEW.remark_code IS NOT DISTINCT FROM OLD.remark_code
     AND NEW.remittance_id IS NOT DISTINCT FROM OLD.remittance_id
     AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
     AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ledger entries cannot be changed; post a correcting entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_guard ON ledger_entries;
CREATE TRIGGER ledger_entries_guard BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_guard();
`,
  },
  {
    name: "0043_booking_templates",
    sql: `-- Saved column mappings for patient imports, by header name, so next month's file maps itself.
CREATE TABLE IF NOT EXISTS import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  mapping jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, name)
);

-- Online booking: whether it is on, the practice's time zone, and each provider's weekly hours.
CREATE TABLE IF NOT EXISTS booking_settings (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  enabled boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'America/New_York',
  slot_minutes integer NOT NULL DEFAULT 30,
  min_notice_hours integer NOT NULL DEFAULT 24,
  horizon_days integer NOT NULL DEFAULT 21,
  intro text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  location_id uuid REFERENCES locations(id),
  weekday smallint NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_hours_provider_idx ON provider_hours (provider_id, weekday);

-- A request from the public booking page. It holds its slot until staff confirm (creating the
-- patient and appointment) or decline it; nothing is written to patient records before then.
CREATE TABLE IF NOT EXISTS booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  location_id uuid REFERENCES locations(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob date NOT NULL,
  phone text,
  email text,
  reason text,
  payer_name text,
  member_id text,
  sms_consent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  appointment_id uuid REFERENCES appointments(id),
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS booking_requests_practice_idx ON booking_requests (practice_id, status, starts_at);
`,
  },
  {
    name: "0044_pilot_ops",
    sql: `-- The request an error happened in, to find it in the platform's logs.
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS last_request_id text;

-- "Report a problem" from inside the app.
CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid REFERENCES users(id),
  page text NOT NULL,
  message text NOT NULL,
  user_agent text,
  viewport text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);

-- How often each part of the app is used, per practice per day. Counts only.
CREATE TABLE IF NOT EXISTS feature_usage (
  practice_id uuid NOT NULL REFERENCES practices(id),
  feature text NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (practice_id, feature, day)
);

-- Exports too big for one run are built in parts, one run each.
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS plan jsonb;
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS parts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS next_part integer NOT NULL DEFAULT 0;
`,
  },
  {
    name: "0045_replies_tips_language",
    sql: `-- Operators answer problem reports; the reporter sees the answer in the app.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS replied_by uuid REFERENCES users(id);

-- Suggestions of features a practice has not tried, and which ones it dismissed.
CREATE TABLE IF NOT EXISTS dismissed_tips (
  practice_id uuid NOT NULL REFERENCES practices(id),
  tip text NOT NULL,
  dismissed_by uuid REFERENCES users(id),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, tip)
);

-- The language a patient reads: statements, reminders and confirmations follow it.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
`,
  },
  {
    name: "0046_practice_time_zone",
    sql: `-- The practice's time zone, for "today", "tomorrow" and online booking.
-- Until now it lived only in the booking settings; those values carry over.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/New_York';
UPDATE practices p SET time_zone = s.time_zone FROM booking_settings s WHERE s.practice_id = p.id AND p.time_zone <> s.time_zone;
`,
  },
  {
    name: "0047_audit_indexes",
    sql: `-- The audit log had no index but its key: the audit page, retention and the
-- per-patient access log (server/access-log.ts) would read the whole table.
CREATE INDEX IF NOT EXISTS audit_log_practice_at_idx ON audit_log (practice_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_practice_entity_idx ON audit_log (practice_id, entity_id, at DESC);
`,
  },
  {
    name: "0048_drop_booking_time_zone",
    sql: `-- The time zone moved to practices (0046); since 2026-09-27 nothing reads or
-- writes this column (the release before this one stopped using it).
ALTER TABLE booking_settings DROP COLUMN IF EXISTS time_zone;
`,
  },
  {
    name: "0049_confirmations_restricted",
    sql: `-- A patient confirming an appointment by replying to the reminder text.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_via text;

-- Restricted patients ("break the glass"): opening their records asks for a
-- reason, which is recorded and sent to the administrators.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;
`,
  },
  {
    name: "0050_waitlist_api_restricted",
    sql: `-- An API key may read restricted patients only when an administrator allows it;
-- each such read is recorded on the patient's access log.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS restricted_access boolean NOT NULL DEFAULT false;

-- Patients who want an earlier appointment. A cancelled time is offered to them
-- by text; the first to reply B gets it.
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  -- Only this provider's openings, or any provider's when null.
  provider_id uuid REFERENCES providers(id),
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the patient takes an offered time, or staff take them off the list.
  closed_at timestamptz,
  closed_reason text
);
CREATE INDEX IF NOT EXISTS waitlist_entries_open_idx ON waitlist_entries (practice_id, created_at) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_one_open_per_patient ON waitlist_entries (practice_id, patient_id) WHERE closed_at IS NULL;

-- A freed time offered to the waitlist, and who it was offered to.
CREATE TABLE IF NOT EXISTS slot_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  cancelled_appointment_id uuid REFERENCES appointments(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  location_id uuid REFERENCES locations(id),
  type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  filled_at timestamptz,
  filled_patient_id uuid REFERENCES patients(id),
  filled_appointment_id uuid REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS slot_offers_practice_idx ON slot_offers (practice_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS slot_offers_one_per_cancellation ON slot_offers (cancelled_appointment_id) WHERE cancelled_appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS slot_offer_recipients (
  offer_id uuid NOT NULL REFERENCES slot_offers(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  waitlist_entry_id uuid NOT NULL REFERENCES waitlist_entries(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, patient_id)
);
CREATE INDEX IF NOT EXISTS slot_offer_recipients_patient_idx ON slot_offer_recipients (patient_id, sent_at);
`,
  },
  {
    name: "0051_tick_delivery_waitlist_windows",
    sql: `-- When something last ran, by name: "tick" is the every-five-minutes run started from outside
-- (server/tick.ts). The status page shows it and the daily job alerts if it stops.
CREATE TABLE IF NOT EXISTS heartbeats (
  name text PRIMARY KEY,
  at timestamptz NOT NULL
);

-- Waitlist: the hours of the day a patient can come (clock hours at the practice; null is any).
ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS from_hour smallint;
ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS until_hour smallint;

-- An opening nobody takes is offered again to the next people on the list, in rounds.
ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS rounds integer NOT NULL DEFAULT 1;
ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS last_round_at timestamptz;
UPDATE slot_offers SET last_round_at = created_at WHERE last_round_at IS NULL;
-- Twilio reported the offer did not reach the phone.
ALTER TABLE slot_offer_recipients ADD COLUMN IF NOT EXISTS undelivered_at timestamptz;

-- Two-factor for administrators and anyone who can export (server/mfa-policy.ts).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS mfa_for_privileged boolean NOT NULL DEFAULT false;

-- Online booking can also ask to join the waitlist: no time, maybe no provider.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'appointment';
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS from_hour smallint;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS until_hour smallint;
ALTER TABLE booking_requests ALTER COLUMN provider_id DROP NOT NULL;
ALTER TABLE booking_requests ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE booking_requests ALTER COLUMN ends_at DROP NOT NULL;

-- Delivery reports arrive by Twilio's message id, which the message log keeps as "sid SM...".
CREATE INDEX IF NOT EXISTS message_log_sms_sid_idx ON message_log (detail) WHERE channel = 'sms';
`,
  },
  {
    name: "0052_subscribers_demo_flag",
    sql: `-- A patient's appointments: whether someone on the waitlist is already booked at an opening's time
-- (server/waitlist.ts), their next visit when they reply C or X (server/sms-inbox.ts), and the access
-- review. Found by the load test's missing-index check.
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id, starts_at);

-- The insured person, when it is not the patient (a child on a parent's plan, a spouse): the 837
-- sends them as the subscriber and the patient in loop 2000C (lib/edi/subscriber.ts).
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_first_name text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_last_name text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_dob date;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_sex text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_address1 text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_city text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_state text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_zip text;

-- The demo practice (seeded, with published sign-ins): the only one the public pages may read
-- from, and the one "Try the demo" signs into.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
UPDATE practices SET is_demo = true WHERE id IN (SELECT practice_id FROM users WHERE email = 'admin@collaboratmd.local');

-- The demo practice's Medicare patients get MBI-shaped member IDs, which the scrubber now requires
-- for Medicare (lib/scrub/rules.ts MEDICARE_MBI). Only the demo practice's rows are touched.
UPDATE patient_insurances pi
SET member_id = (1 + abs(hashtext(pi.id::text)) % 9)::text || 'EG' || (abs(hashtext(pi.id::text)) % 10)::text || 'TE'
  || ((abs(hashtext(pi.id::text)) / 10) % 10)::text || 'MK' || (10 + abs(hashtext(pi.id::text)) % 90)::text
FROM payers p, patients pt
WHERE p.id = pi.payer_id AND p.type = 'medicare' AND pt.id = pi.patient_id
  AND pt.practice_id IN (SELECT id FROM practices WHERE is_demo)
  AND upper(replace(pi.member_id, '-', '')) !~ '^[1-9][AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9][AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9][AC-HJKMNP-RT-Y]{2}[0-9]{2}$';
`,
  },
  {
    name: "0053_billing_entity_referring_clia",
    sql: `-- Who bills: the practice as an organization (Type 2 NPI, the default), or a solo provider under
-- their own Type 1 NPI, whose name then goes in the billing provider loop (2010AA NM1*85*1).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_entity text NOT NULL DEFAULT 'organization';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_last_name text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_first_name text;

-- The practice's CLIA certificate number, sent on claims with laboratory tests (2300 REF*X4).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS clia_number text;

-- The provider who referred the patient, when the payer needs one (2310A NM1*DN).
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referring_last_name text;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referring_first_name text;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referring_npi text;

-- The demo practice bills lab tests: a (fictional) CLIA number, so its claims pass the new check.
UPDATE practices SET clia_number = '10D1234567' WHERE is_demo AND clia_number IS NULL;
`,
  },
  {
    name: "0054_code_sets_accidents_paper_claims",
    sql: `-- ICD-10-CM by fiscal year: a code is valid on a date of service when its fiscal year (October to
-- September) is between the first and the latest CMS file that listed it. Header codes are not billable.
ALTER TABLE icd10_codes ADD COLUMN IF NOT EXISTS billable boolean NOT NULL DEFAULT true;
ALTER TABLE icd10_codes ADD COLUMN IF NOT EXISTS first_year integer;
ALTER TABLE icd10_codes ADD COLUMN IF NOT EXISTS seen_year integer;

-- HCPCS Level II from CMS's public file.
CREATE TABLE IF NOT EXISTS hcpcs_codes (
  code text PRIMARY KEY,
  description text NOT NULL,
  short_description text,
  added_on date,
  terminated_on date
);

-- Procedure codes a practice bills beyond the built-in list, in its own words.
CREATE TABLE IF NOT EXISTS practice_codes (
  practice_id uuid NOT NULL REFERENCES practices(id),
  code text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, code)
);

-- Accidents and workers' comp (CLM11, DTP*439, REF*Y4; boxes 10 and 11b).
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS related_employment boolean NOT NULL DEFAULT false;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS related_auto boolean NOT NULL DEFAULT false;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS auto_accident_state text;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS related_other boolean NOT NULL DEFAULT false;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS accident_date date;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS property_claim_number text;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS employer_name text;

-- Paper claims: printer alignment. 837 files for another clearinghouse: the IDs it assigned.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS form_offset_x integer NOT NULL DEFAULT 0;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS form_offset_y integer NOT NULL DEFAULT 0;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS edi_submitter_id text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS edi_receiver_id text;

-- CollaboratMD's own invoices, from the platform's Stripe events.
CREATE TABLE IF NOT EXISTS platform_invoices (
  id text PRIMARY KEY,
  practice_id uuid NOT NULL REFERENCES practices(id),
  number text,
  status text NOT NULL,
  amount_due_cents integer NOT NULL,
  amount_paid_cents integer NOT NULL,
  hosted_url text,
  pdf_url text,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS platform_invoices_practice_idx ON platform_invoices (practice_id, created_at);

-- Backup restore tests, recorded by operators.
CREATE TABLE IF NOT EXISTS restore_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tested_at timestamptz NOT NULL,
  target text NOT NULL,
  minutes integer,
  result text NOT NULL,
  notes text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  },
  {
    name: "0055_mpfs_msp_time_passkeys_quality",
    sql: `-- Fast code search: word search by full-text index, code prefixes by the primary key range.
CREATE INDEX IF NOT EXISTS icd10_codes_description_fts ON icd10_codes USING gin (to_tsvector('english', description));
CREATE INDEX IF NOT EXISTS hcpcs_codes_description_fts ON hcpcs_codes USING gin (to_tsvector('english', description));

-- Medicare physician fee schedule: RVUs, locality GPCIs and the conversion factor, by year.
CREATE TABLE IF NOT EXISTS mpfs_rvus (
  year integer NOT NULL,
  code text NOT NULL,
  modifier text NOT NULL DEFAULT '',
  status text,
  work_rvu numeric NOT NULL,
  pe_non_facility numeric NOT NULL,
  pe_facility numeric NOT NULL,
  mp_rvu numeric NOT NULL,
  mult_proc text,
  PRIMARY KEY (year, code, modifier)
);
CREATE TABLE IF NOT EXISTS mpfs_localities (
  year integer NOT NULL,
  carrier text NOT NULL,
  locality text NOT NULL,
  name text NOT NULL,
  state text,
  work_gpci numeric NOT NULL,
  pe_gpci numeric NOT NULL,
  mp_gpci numeric NOT NULL,
  PRIMARY KEY (year, carrier, locality)
);
CREATE TABLE IF NOT EXISTS mpfs_years (
  year integer PRIMARY KEY,
  conversion_factor numeric NOT NULL
);
ALTER TABLE practices ADD COLUMN IF NOT EXISTS medicare_carrier text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS medicare_locality text;

-- Medicare Secondary Payer: the reason Medicare pays second (SBR05), the questions asked, and crossovers.
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS msp_type text;
CREATE TABLE IF NOT EXISTS msp_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  answers jsonb NOT NULL,
  medicare_primary boolean NOT NULL,
  msp_type text,
  screened_at timestamptz NOT NULL DEFAULT now(),
  screened_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS msp_screenings_patient_idx ON msp_screenings (patient_id, screened_at);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS crossover_payer text;

-- Time-based codes: minutes on the line; anesthesia base units.
ALTER TABLE charges ADD COLUMN IF NOT EXISTS minutes integer;
CREATE TABLE IF NOT EXISTS anesthesia_base_units (
  code text PRIMARY KEY,
  base_units integer NOT NULL
);

-- Saved import mappings.
CREATE TABLE IF NOT EXISTS import_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid REFERENCES practices(id),
  kind text NOT NULL,
  name text NOT NULL,
  mapping jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Passkeys.
CREATE TABLE IF NOT EXISTS passkeys (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  public_key text NOT NULL,
  algorithm integer NOT NULL,
  sign_count integer NOT NULL DEFAULT 0,
  transports jsonb,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys (user_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL,
  user_id uuid REFERENCES users(id),
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Quality measures reported on claims.
CREATE TABLE IF NOT EXISTS quality_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  number text NOT NULL,
  title text NOT NULL,
  eligible_codes jsonb NOT NULL,
  dx_prefixes jsonb NOT NULL DEFAULT '[]',
  min_age integer,
  max_age integer,
  codes jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quality_measures_practice_idx ON quality_measures (practice_id);
`,
  },
  {
    name: "0056_ndc_plb_appeals_abn",
    sql: `-- Drug lines: the National Drug Code, unit and quantity (837P 2410 LIN/CTP).
ALTER TABLE charges ADD COLUMN IF NOT EXISTS ndc text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS ndc_unit text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS ndc_quantity numeric;

-- 835 provider-level adjustments (PLB): takebacks for other claims, interest, forwarding balances.
CREATE TABLE IF NOT EXISTS remittance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  remittance_id uuid NOT NULL REFERENCES remittances(id),
  reason text NOT NULL,
  reference text,
  amount_cents integer NOT NULL,
  claim_id uuid REFERENCES claims(id),
  posted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS remittance_adjustments_remit_idx ON remittance_adjustments (remittance_id);
CREATE INDEX IF NOT EXISTS remittance_adjustments_claim_idx ON remittance_adjustments (claim_id);

-- Appeal levels, each with its deadline and the payer's decision.
CREATE TABLE IF NOT EXISTS appeal_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  denial_id uuid NOT NULL REFERENCES denials(id),
  level integer NOT NULL,
  name text NOT NULL,
  due_on date,
  filed_on date,
  decision text,
  decided_on date,
  letter_id uuid REFERENCES appeal_letters(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appeal_levels_denial_idx ON appeal_levels (denial_id);

-- Advance Beneficiary Notices.
CREATE TABLE IF NOT EXISTS abns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  service_date date NOT NULL,
  services jsonb NOT NULL,
  reason text NOT NULL,
  option integer,
  signed_on date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abns_patient_idx ON abns (patient_id, service_date);

-- When an insurance overpayment was identified (the 60-day refund clock).
CREATE TABLE IF NOT EXISTS overpayment_identifications (
  claim_id uuid PRIMARY KEY REFERENCES claims(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  identified_on date NOT NULL,
  identified_by uuid REFERENCES users(id)
);

-- CMS's list of Medicare telehealth services.
CREATE TABLE IF NOT EXISTS medicare_telehealth_codes (
  year integer NOT NULL,
  code text NOT NULL,
  status text,
  PRIMARY KEY (year, code)
);
`,
  },
  {
    name: "0057_globals_ma_care_records_promptpay",
    sql: `-- Global surgery days from CMS's RVU file.
ALTER TABLE mpfs_rvus ADD COLUMN IF NOT EXISTS global_days text;

-- Provider credential (NP/PA/CNS paid 85% of Medicare's fee schedule) and the supervising physician on a service.
ALTER TABLE providers ADD COLUMN IF NOT EXISTS credential text;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS supervising_provider_id uuid REFERENCES providers(id);

-- Monthly care programs (CCM, BHI, RPM): consent and minutes.
CREATE TABLE IF NOT EXISTS care_program_consents (
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  program text NOT NULL,
  consented_on date NOT NULL,
  recorded_by uuid REFERENCES users(id),
  PRIMARY KEY (patient_id, program)
);
CREATE TABLE IF NOT EXISTS care_minutes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  program text NOT NULL,
  month text NOT NULL,
  performed_on date NOT NULL,
  minutes integer NOT NULL,
  note text,
  logged_by uuid REFERENCES users(id),
  claim_id uuid REFERENCES claims(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS care_minutes_patient_idx ON care_minutes (patient_id, program, month);

-- Payer requests for medical records (ADR, RAC, TPE, commercial audits).
CREATE TABLE IF NOT EXISTS records_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid REFERENCES patients(id),
  claim_id uuid REFERENCES claims(id),
  payer_id uuid REFERENCES payers(id),
  kind text NOT NULL,
  reference text,
  received_on date NOT NULL,
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  sent_on date,
  sent_via text,
  outcome text,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS records_requests_practice_idx ON records_requests (practice_id, status, due_on);

-- Prompt-pay statutes as the practice enters them, and interest asked for.
CREATE TABLE IF NOT EXISTS prompt_pay_rules (
  practice_id uuid NOT NULL REFERENCES practices(id),
  state text NOT NULL,
  days integer NOT NULL,
  annual_rate_pct numeric NOT NULL,
  citation text,
  PRIMARY KEY (practice_id, state)
);
CREATE TABLE IF NOT EXISTS prompt_pay_requests (
  claim_id uuid PRIMARY KEY REFERENCES claims(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  days_late integer NOT NULL,
  interest_cents integer NOT NULL,
  requested_on date NOT NULL,
  received_cents integer
);
`,
  },
  {
    name: "0058_split_shared_nsa_sliding_fee",
    sql: `-- Split/shared facility visits and teaching-physician presence.
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS shared_with_provider_id uuid REFERENCES providers(id);
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS substantive_attested boolean NOT NULL DEFAULT false;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS teaching_present boolean NOT NULL DEFAULT false;

-- No Surprises Act payment disputes.
CREATE TABLE IF NOT EXISTS nsa_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  initial_response_on date NOT NULL,
  offer_cents integer,
  negotiation_started_on date,
  idr_initiated_on date,
  status text NOT NULL DEFAULT 'open',
  outcome text,
  settled_cents integer,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nsa_disputes_practice_idx ON nsa_disputes (practice_id, status);

-- Sliding fee scale.
CREATE TABLE IF NOT EXISTS poverty_guidelines (
  practice_id uuid NOT NULL REFERENCES practices(id),
  year integer NOT NULL,
  base_cents integer NOT NULL,
  per_person_cents integer NOT NULL,
  PRIMARY KEY (practice_id, year)
);
CREATE TABLE IF NOT EXISTS sliding_fee_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  max_percent integer NOT NULL,
  discount_percent integer NOT NULL,
  label text
);
CREATE TABLE IF NOT EXISTS patient_sliding_fees (
  patient_id uuid PRIMARY KEY REFERENCES patients(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  household_size integer NOT NULL,
  annual_income_cents integer NOT NULL,
  percent_of_poverty integer NOT NULL,
  discount_percent integer NOT NULL,
  proof text NOT NULL,
  verified_on date NOT NULL,
  expires_on date NOT NULL,
  recorded_by uuid REFERENCES users(id)
);
`,
  },
  {
    name: "0059_card_on_file_hcc_refund_demands",
    sql: `-- Card on file for balances after insurance.
ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS balance_max_cents integer;
ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS balance_authorized_at timestamptz;
CREATE TABLE IF NOT EXISTS card_charge_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  card_id uuid NOT NULL REFERENCES saved_cards(id),
  amount_cents integer NOT NULL,
  notice_on date NOT NULL,
  charge_on date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  detail text,
  online_payment_id uuid REFERENCES online_payments(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_charge_notices_patient_idx ON card_charge_notices (patient_id, status);

-- CMS's diagnosis to HCC mapping.
CREATE TABLE IF NOT EXISTS hcc_mappings (
  year integer NOT NULL,
  icd10 text NOT NULL,
  hcc text NOT NULL,
  label text,
  PRIMARY KEY (year, icd10, hcc)
);

-- Payer refund demands.
CREATE TABLE IF NOT EXISTS payer_refund_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  amount_cents integer NOT NULL,
  reference text,
  received_on date NOT NULL,
  dispute_by date,
  offset_on date,
  status text NOT NULL DEFAULT 'open',
  refund_id uuid REFERENCES refunds(id),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payer_refund_demands_practice_idx ON payer_refund_demands (practice_id, status);
`,
  },
  {
    name: "0060_remittance_lines_collections_safeguards",
    sql: `-- 835 service lines, kept per code when a remittance posts.
CREATE TABLE IF NOT EXISTS remittance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  remittance_id uuid NOT NULL REFERENCES remittances(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  cpt text NOT NULL,
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  units integer NOT NULL,
  charged_cents integer NOT NULL,
  allowed_cents integer NOT NULL,
  paid_cents integer NOT NULL,
  adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
  remarks jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_date date NOT NULL
);
CREATE INDEX IF NOT EXISTS remittance_lines_claim_idx ON remittance_lines (claim_id);
CREATE INDEX IF NOT EXISTS remittance_lines_payer_code_idx ON remittance_lines (practice_id, payer_id, cpt);

-- Financial assistance offered, a safeguard before collections.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS assistance_offered_on date;
`,
  },
  {
    name: "0061_lookup_indexes",
    sql: `-- Columns the app looks rows up by that had no index, found with the load test.
-- A claim's denials (the claim page, and every report that asks whether a claim was denied).
CREATE INDEX IF NOT EXISTS denials_claim_idx ON denials (claim_id);
-- Corrected and void claims that point at an original.
CREATE INDEX IF NOT EXISTS claims_original_idx ON claims (original_claim_id) WHERE original_claim_id IS NOT NULL;
-- The visit billed for an appointment (missed charges).
CREATE INDEX IF NOT EXISTS encounters_appointment_idx ON encounters (appointment_id) WHERE appointment_id IS NOT NULL;
-- Ledger entries for a charge line (editing a claim's lines).
CREATE INDEX IF NOT EXISTS ledger_charge_idx ON ledger_entries (charge_id) WHERE charge_id IS NOT NULL;
`,
  },
  {
    name: "0062_code_changes_disclosures_credits_contracts_ordering",
    sql: `-- ICD-10-CM: the fiscal year a code's billable flag last changed (from CMS's addenda). Before it, the flag was the opposite.
ALTER TABLE icd10_codes ADD COLUMN IF NOT EXISTS changed_year integer;

-- HIPAA: disclosures of a patient's information outside the practice (45 CFR 164.528), whether or not they need accounting.
CREATE TABLE IF NOT EXISTS disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  disclosed_on date NOT NULL,
  recipient text NOT NULL,
  recipient_address text,
  purpose text NOT NULL,
  description text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_id uuid,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disclosures_patient_idx ON disclosures (practice_id, patient_id, disclosed_on);
CREATE UNIQUE INDEX IF NOT EXISTS disclosures_source_idx ON disclosures (source, source_id) WHERE source_id IS NOT NULL;

-- HIPAA right of access (45 CFR 164.524): a patient's request for their own records, due in 30 days (one 30-day extension).
CREATE TABLE IF NOT EXISTS access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL DEFAULT 'copy',
  received_on date NOT NULL,
  due_on date NOT NULL,
  format text,
  deliver_to text,
  fee_cents integer NOT NULL DEFAULT 0,
  extended_on date,
  extension_reason text,
  status text NOT NULL DEFAULT 'open',
  completed_on date,
  denial_reason text,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_requests_practice_idx ON access_requests (practice_id, status, due_on);

-- Unclaimed patient credits: the due-diligence letter before a credit is reported to the state as unclaimed property.
CREATE TABLE IF NOT EXISTS unclaimed_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  amount_cents integer NOT NULL,
  last_activity_on date NOT NULL,
  letter_sent_on date,
  status text NOT NULL DEFAULT 'letter_due',
  resolved_on date,
  resolution text,
  reported_year integer,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS unclaimed_credits_open_idx ON unclaimed_credits (practice_id, patient_id) WHERE status IN ('letter_due', 'letter_sent', 'to_report');

-- Payer contract terms: when it renews, how much notice to end or renegotiate it, and any scheduled increase.
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS renews_on date;
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS notice_days integer;
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS escalator_pct numeric(5,2);
ALTER TABLE fee_schedules ADD COLUMN IF NOT EXISTS terms_notes text;

-- CMS's Medicare Order and Referring file: who may order or refer, by service type.
CREATE TABLE IF NOT EXISTS ordering_referring (
  npi text PRIMARY KEY,
  last_name text NOT NULL,
  first_name text,
  part_b boolean NOT NULL DEFAULT false,
  dme boolean NOT NULL DEFAULT false,
  hha boolean NOT NULL DEFAULT false,
  pmd boolean NOT NULL DEFAULT false,
  hospice boolean NOT NULL DEFAULT false
);
`,
  },
  {
    name: "0063_merge_close_queries_therapy_liens_audits",
    sql: `-- Duplicate patients: the record merged away points at the one kept; who registered a patient or a policy, and how.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES patients(id);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_at timestamptz;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS source text;

-- Why a balance was written off, chosen when it is (timely filing, no authorization, small balance...).
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS write_off_category text;

-- The ledger guard, again: merging a duplicate patient may move its entries to the patient kept, and nothing else changes.
CREATE OR REPLACE FUNCTION ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM practices p WHERE p.id = OLD.practice_id AND p.closing_at IS NOT NULL AND p.closing_at <= now()) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Ledger entries cannot be deleted; post a correcting entry instead';
  END IF;
  IF NEW.practice_id IS NOT DISTINCT FROM OLD.practice_id
     AND (NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
          OR EXISTS (SELECT 1 FROM patients p WHERE p.id = OLD.patient_id AND p.merged_into = NEW.patient_id))
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
     AND NEW.group_code IS NOT DISTINCT FROM OLD.group_code
     AND NEW.reason_code IS NOT DISTINCT FROM OLD.reason_code
     AND NEW.remark_code IS NOT DISTINCT FROM OLD.remark_code
     AND NEW.remittance_id IS NOT DISTINCT FROM OLD.remittance_id
     AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
     AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
     AND NEW.write_off_category IS NOT DISTINCT FROM OLD.write_off_category THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ledger entries cannot be changed; post a correcting entry instead';
END;
$$ LANGUAGE plpgsql;

-- A closed month is locked: nothing can be posted dated into it (post it today instead, or reopen the month).
CREATE OR REPLACE FUNCTION ledger_period_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM period_closes pc
    WHERE pc.practice_id = NEW.practice_id
      AND NEW.posted_at >= to_date(pc.period || '-01', 'YYYY-MM-DD')
      AND NEW.posted_at < (to_date(pc.period || '-01', 'YYYY-MM-DD') + interval '1 month')
  ) THEN
    RAISE EXCEPTION 'That date is in a closed month; post it in the current month, or reopen the month first';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_period_lock ON ledger_entries;
CREATE TRIGGER ledger_period_lock BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_period_lock();

-- A coder's question to the provider about a visit; the claim waits for the answer.
CREATE TABLE IF NOT EXISTS coding_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  topic text NOT NULL,
  question text NOT NULL,
  answer text,
  status text NOT NULL DEFAULT 'open',
  asked_by uuid REFERENCES users(id),
  asked_at timestamptz NOT NULL DEFAULT now(),
  answered_by uuid REFERENCES users(id),
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS coding_queries_practice_idx ON coding_queries (practice_id, status);
CREATE INDEX IF NOT EXISTS coding_queries_encounter_idx ON coding_queries (encounter_id);

-- Medicare's yearly therapy threshold (KX) and targeted medical review amount, entered by the platform operator.
CREATE TABLE IF NOT EXISTS therapy_thresholds (
  year integer PRIMARY KEY,
  kx_cents integer NOT NULL,
  review_cents integer,
  entered_by text,
  entered_at timestamptz NOT NULL DEFAULT now()
);

-- Personal injury cases: an attorney's lien or letter of protection holds the patient's balance until settlement.
CREATE TABLE IF NOT EXISTS injury_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  attorney text NOT NULL,
  firm text,
  phone text,
  email text,
  case_number text,
  accident_on date,
  lien_signed_on date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  reduction_requested_cents integer,
  reduction_agreed_cents integer,
  settled_on date,
  settlement_paid_cents integer,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS injury_cases_practice_idx ON injury_cases (practice_id, status);
CREATE INDEX IF NOT EXISTS injury_cases_patient_idx ON injury_cases (patient_id);

-- Internal coding audits: a sample of each provider's claims, scored against the documentation.
CREATE TABLE IF NOT EXISTS coding_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  per_provider integer NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS coding_audit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES coding_audits(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  result text NOT NULL DEFAULT 'pending',
  finding text,
  billed_code text,
  correct_code text,
  note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS coding_audit_items_audit_idx ON coding_audit_items (audit_id);
`,
  },
  {
    name: "0064_qmb_guarantor_cash_agency_fees_rootcause_cdm_comp",
    sql: `-- Medicare dual eligibles: a Qualified Medicare Beneficiary may not be billed Medicare cost-sharing.
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS qmb boolean NOT NULL DEFAULT false;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS qmb_verified_on date;

-- Family accounts: the person responsible for a patient's bill (a parent for a minor).
ALTER TABLE patients ADD COLUMN IF NOT EXISTS guarantor_id uuid REFERENCES patients(id);

-- How a payment was made (cash, check, card, ach, online, terminal, card_on_file, agency, settlement), for the daily close.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS payment_method text;

-- The front desk's end of day: what was counted against what was posted, by method.
CREATE TABLE IF NOT EXISTS cash_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  day date NOT NULL,
  expected jsonb NOT NULL,
  counted_cash_cents integer NOT NULL DEFAULT 0,
  counted_checks_cents integer NOT NULL DEFAULT 0,
  card_batch_cents integer NOT NULL DEFAULT 0,
  deposit_reference text,
  notes text,
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cash_closes_day_idx ON cash_closes (practice_id, day);

-- What a collection agency collected, what it kept as commission, and what it sent the practice.
CREATE TABLE IF NOT EXISTS agency_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  collection_id uuid NOT NULL REFERENCES patient_collections(id),
  received_on date NOT NULL,
  gross_cents integer NOT NULL,
  commission_cents integer NOT NULL,
  reference text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_recoveries_practice_idx ON agency_recoveries (practice_id, received_on);
ALTER TABLE patient_collections ADD COLUMN IF NOT EXISTS commission_pct numeric(5,2);

-- Why a denial happened and whose process owns preventing it.
ALTER TABLE denials ADD COLUMN IF NOT EXISTS root_cause text;
ALTER TABLE denials ADD COLUMN IF NOT EXISTS root_owner text;

-- A facility's chargemaster: each billable item with its revenue code, procedure code and gross charge.
CREATE TABLE IF NOT EXISTS chargemaster_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  item_code text NOT NULL,
  description text NOT NULL,
  revenue_code text NOT NULL,
  hcpcs text,
  modifiers text,
  price_cents integer NOT NULL,
  cash_price_cents integer,
  setting text NOT NULL DEFAULT 'both',
  active boolean NOT NULL DEFAULT true,
  reviewed_on date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chargemaster_items_code_idx ON chargemaster_items (practice_id, item_code);

-- Provider compensation plans: how each provider is paid, from collections or work RVUs.
CREATE TABLE IF NOT EXISTS comp_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  kind text NOT NULL,
  base_cents integer NOT NULL DEFAULT 0,
  collections_pct numeric(5,2),
  per_rvu_cents integer,
  threshold numeric(12,2),
  effective_from date NOT NULL,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comp_plans_provider_idx ON comp_plans (practice_id, provider_id, effective_from);

-- Missed-appointment fees: when an appointment was cancelled (late cancellations), and when the patient agreed to the fee policy.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS fee_policy_signed_on date;
`,
  },
  {
    name: "0065_mail_holds_referrals_complaints_costs",
    sql: `-- Returned mail: mail to the address came back. Cleared whenever the address changes, however it is changed.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS address_bad_since date;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS address_bad_note text;

CREATE OR REPLACE FUNCTION patients_address_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW.address_bad_since IS NOT NULL AND NEW.address_bad_since IS NOT DISTINCT FROM OLD.address_bad_since
     AND (NEW.address1, NEW.city, NEW.state, NEW.zip) IS DISTINCT FROM (OLD.address1, OLD.city, OLD.state, OLD.zip) THEN
    NEW.address_bad_since := NULL;
    NEW.address_bad_note := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS patients_address_fixed ON patients;
CREATE TRIGGER patients_address_fixed BEFORE UPDATE ON patients FOR EACH ROW EXECUTE FUNCTION patients_address_fixed();

-- An adult dependent who agreed to keep their bill with the guarantor (a student on a parent's plan, for example).
ALTER TABLE patients ADD COLUMN IF NOT EXISTS guarantor_adult_consent_on date;

-- Where a new patient came from.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_source text;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS referral_detail text;

-- Bankruptcy (the automatic stay) and deceased patients (a claim against the estate) hold collection activity.
CREATE TABLE IF NOT EXISTS account_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  kind text NOT NULL, -- bankruptcy | deceased
  status text NOT NULL DEFAULT 'open', -- open | closed
  started_on date NOT NULL, -- the filing date, or the date of death
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  deadline date, -- proof of claim or estate claim deadline
  claim_filed_on date,
  outcome text, -- discharged | dismissed | estate_paid | estate_closed
  closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_holds_patient_idx ON account_holds (patient_id, status);

-- HIPAA privacy complaints (45 CFR 164.530(d)): received, investigated, answered, documented.
CREATE TABLE IF NOT EXISTS privacy_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  received_on date NOT NULL,
  channel text NOT NULL, -- phone | email | letter | in_person | portal | ocr
  complainant text NOT NULL,
  patient_id uuid REFERENCES patients(id),
  category text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open', -- open | closed
  investigation text,
  finding text, -- substantiated | not_substantiated | inconclusive
  mitigation text,
  sanctions text,
  responded_on date,
  closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- What billing cost each month, for cost to collect.
CREATE TABLE IF NOT EXISTS billing_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  month text NOT NULL, -- YYYY-MM
  category text NOT NULL,
  cents integer NOT NULL,
  note text,
  created_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_costs_month_idx ON billing_costs (practice_id, month, category);
`,
  },
  {
    name: "0066_locums_referrals_therapy_plans_cob_interpreters",
    sql: `-- Substitute physicians: locum tenens (Q6) and reciprocal billing (Q5) for an absent provider.
CREATE TABLE IF NOT EXISTS substitute_arrangements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  absent_provider_id uuid NOT NULL REFERENCES providers(id),
  kind text NOT NULL, -- locum | reciprocal
  substitute_name text NOT NULL,
  substitute_npi text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS substitute_id uuid REFERENCES substitute_arrangements(id);

-- Referrals from a primary care physician that an HMO requires before a specialist visit (REF*9F on the claim).
ALTER TABLE payers ADD COLUMN IF NOT EXISTS requires_referral boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS patient_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  referral_number text NOT NULL,
  referring_name text,
  referring_npi text,
  visits_allowed integer,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_referrals_patient_idx ON patient_referrals (patient_id, payer_id);

-- Therapy plans of care and their physician certification (Medicare outpatient therapy).
CREATE TABLE IF NOT EXISTS therapy_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  discipline text NOT NULL, -- pt | ot | slp
  starts_on date NOT NULL, -- the evaluation / first treatment
  ends_on date NOT NULL, -- the plan's last day (at most 90 days)
  certified_on date, -- the physician or NPP signed it
  certifier_name text,
  certifier_npi text,
  delay_reason text, -- certified late: why
  previous_plan_id uuid REFERENCES therapy_plans(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS therapy_plans_patient_idx ON therapy_plans (patient_id, discipline, starts_on);

-- The yearly "do you have any other insurance?" answer.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS other_coverage_checked_on date;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS other_coverage boolean;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS other_coverage_detail text;

-- Language access: who needs an interpreter, and each time one was provided.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS interpreter_language text;
CREATE TABLE IF NOT EXISTS interpreter_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  appointment_id uuid REFERENCES appointments(id),
  served_on date NOT NULL,
  language text NOT NULL,
  mode text NOT NULL, -- in_person | phone | video | staff
  vendor text,
  minutes integer NOT NULL,
  cost_cents integer,
  declined boolean NOT NULL DEFAULT false, -- the patient declined and used their own (adult) interpreter
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interpreter_services_practice_idx ON interpreter_services (practice_id, served_on);
`,
  },
];
