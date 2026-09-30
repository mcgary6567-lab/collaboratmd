-- ICD-10-CM: the fiscal year a code's billable flag last changed (from CMS's addenda). Before it, the flag was the opposite.
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
