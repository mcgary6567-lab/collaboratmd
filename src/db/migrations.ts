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
];
