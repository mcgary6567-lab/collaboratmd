-- Card on file for balances after insurance.
ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS balance_max_cents integer;
ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS balance_authorized_at timestamptz;
CREATE TABLE IF NOT EXISTS card_charge_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  card_id uuid NOT NULL REFERENCES saved_cards(id),
  amount_cents integer NOT NULL,
  notice_on date NOT NULL,
  charge_on date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  detail text,
  online_payment_id uuid REFERENCES online_payments(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_charge_notices_patient_idx ON card_charge_notices (patient_id, status);

-- CMS's diagnosis to HCC mapping.
CREATE TABLE IF NOT EXISTS hcc_mappings (
  year integer NOT NULL,
  icd10 text NOT NULL,
  hcc text NOT NULL,
  label text,
  PRIMARY KEY (year, icd10, hcc)
);

-- Payer refund demands.
CREATE TABLE IF NOT EXISTS payer_refund_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  amount_cents integer NOT NULL,
  reference text,
  received_on date NOT NULL,
  dispute_by date,
  offset_on date,
  status text NOT NULL DEFAULT 'open',
  refund_id uuid REFERENCES refunds(id),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payer_refund_demands_practice_idx ON payer_refund_demands (practice_id, status);
