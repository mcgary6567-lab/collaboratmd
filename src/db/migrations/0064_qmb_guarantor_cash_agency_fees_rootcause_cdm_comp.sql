-- Medicare dual eligibles: a Qualified Medicare Beneficiary may not be billed Medicare cost-sharing.
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
