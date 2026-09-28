-- ICD-10-CM by fiscal year: a code is valid on a date of service when its fiscal year (October to
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
