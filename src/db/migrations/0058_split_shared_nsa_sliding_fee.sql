-- Split/shared facility visits and teaching-physician presence.
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
