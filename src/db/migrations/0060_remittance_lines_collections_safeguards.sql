-- 835 service lines, kept per code when a remittance posts.
CREATE TABLE IF NOT EXISTS remittance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  remittance_id uuid NOT NULL REFERENCES remittances(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  cpt text NOT NULL,
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb,
  units integer NOT NULL,
  charged_cents integer NOT NULL,
  allowed_cents integer NOT NULL,
  paid_cents integer NOT NULL,
  adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,
  remarks jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_date date NOT NULL
);
CREATE INDEX IF NOT EXISTS remittance_lines_claim_idx ON remittance_lines (claim_id);
CREATE INDEX IF NOT EXISTS remittance_lines_payer_code_idx ON remittance_lines (practice_id, payer_id, cpt);

-- Financial assistance offered, a safeguard before collections.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS assistance_offered_on date;
