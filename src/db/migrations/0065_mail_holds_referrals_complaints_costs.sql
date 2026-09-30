-- Returned mail: mail to the address came back. Cleared whenever the address changes, however it is changed.
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
