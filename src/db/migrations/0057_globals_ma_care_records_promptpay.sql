-- Global surgery days from CMS's RVU file.
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
