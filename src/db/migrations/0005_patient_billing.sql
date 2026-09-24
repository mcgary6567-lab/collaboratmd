-- Patient financial responsibility: discounts, payment plans, statements and
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
