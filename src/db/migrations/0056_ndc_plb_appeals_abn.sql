-- Drug lines: the National Drug Code, unit and quantity (837P 2410 LIN/CTP).
ALTER TABLE charges ADD COLUMN IF NOT EXISTS ndc text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS ndc_unit text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS ndc_quantity numeric;

-- 835 provider-level adjustments (PLB): takebacks for other claims, interest, forwarding balances.
CREATE TABLE IF NOT EXISTS remittance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  remittance_id uuid NOT NULL REFERENCES remittances(id),
  reason text NOT NULL,
  reference text,
  amount_cents integer NOT NULL,
  claim_id uuid REFERENCES claims(id),
  posted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS remittance_adjustments_remit_idx ON remittance_adjustments (remittance_id);
CREATE INDEX IF NOT EXISTS remittance_adjustments_claim_idx ON remittance_adjustments (claim_id);

-- Appeal levels, each with its deadline and the payer's decision.
CREATE TABLE IF NOT EXISTS appeal_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  denial_id uuid NOT NULL REFERENCES denials(id),
  level integer NOT NULL,
  name text NOT NULL,
  due_on date,
  filed_on date,
  decision text,
  decided_on date,
  letter_id uuid REFERENCES appeal_letters(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appeal_levels_denial_idx ON appeal_levels (denial_id);

-- Advance Beneficiary Notices.
CREATE TABLE IF NOT EXISTS abns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  service_date date NOT NULL,
  services jsonb NOT NULL,
  reason text NOT NULL,
  option integer,
  signed_on date,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS abns_patient_idx ON abns (patient_id, service_date);

-- When an insurance overpayment was identified (the 60-day refund clock).
CREATE TABLE IF NOT EXISTS overpayment_identifications (
  claim_id uuid PRIMARY KEY REFERENCES claims(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  identified_on date NOT NULL,
  identified_by uuid REFERENCES users(id)
);

-- CMS's list of Medicare telehealth services.
CREATE TABLE IF NOT EXISTS medicare_telehealth_codes (
  year integer NOT NULL,
  code text NOT NULL,
  status text,
  PRIMARY KEY (year, code)
);
