-- Fee schedules and underpayment detection.
--
-- A schedule with no payer is the practice's standard charge master: what it
-- bills. A schedule with a payer holds that payer's contracted allowed
-- amounts: what the contract says it should be paid. Comparing the second
-- against what a remittance actually allowed is how underpayments are found.
CREATE TABLE IF NOT EXISTS fee_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  payer_id uuid REFERENCES payers(id),
  name text NOT NULL,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One active schedule per payer, and one active standard schedule per practice.
-- NULLs are distinct in a plain unique index, so the standard schedule is keyed
-- on a sentinel.
CREATE UNIQUE INDEX IF NOT EXISTS fee_schedules_active_idx
  ON fee_schedules (practice_id, COALESCE(payer_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active;

CREATE TABLE IF NOT EXISTS fee_schedule_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_schedule_id uuid NOT NULL REFERENCES fee_schedules(id) ON DELETE CASCADE,
  cpt text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  UNIQUE (fee_schedule_id, cpt)
);

CREATE TABLE IF NOT EXISTS underpayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  remittance_id uuid REFERENCES remittances(id),
  expected_allowed_cents integer NOT NULL,
  actual_allowed_cents integer NOT NULL,
  variance_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  note text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS underpayments_claim_idx ON underpayments (claim_id);
CREATE INDEX IF NOT EXISTS underpayments_status_idx ON underpayments (practice_id, status);
