-- Underpayment disputes: the letter sent and what came back.
ALTER TABLE underpayments ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE underpayments ADD COLUMN IF NOT EXISTS recovered_cents integer;

-- Appointments reviewed as not billable, so they stop showing as missed charges.
CREATE TABLE IF NOT EXISTS charge_review_dismissals (
  appointment_id uuid PRIMARY KEY REFERENCES appointments(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  reason text NOT NULL,
  dismissed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Refunds of credit balances: requested, approved, then issued (which posts the ledger entry).
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  claim_id uuid REFERENCES claims(id),
  payee text NOT NULL,              -- patient | payer
  payer_id uuid REFERENCES payers(id),
  amount_cents integer NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested', -- requested | approved | issued | cancelled
  method text,
  reference text,
  ledger_entry_id uuid REFERENCES ledger_entries(id),
  requested_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  issued_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  issued_at timestamptz
);
CREATE INDEX IF NOT EXISTS refunds_practice_idx ON refunds (practice_id, status);
