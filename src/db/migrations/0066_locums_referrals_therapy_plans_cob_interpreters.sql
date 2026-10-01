-- Substitute physicians: locum tenens (Q6) and reciprocal billing (Q5) for an absent provider.
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
