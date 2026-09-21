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
];
