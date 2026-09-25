-- Claim status inquiries (276) and the payer's answers (277), kept per claim
-- so follow-up shows what the payer said and when it was last asked.
CREATE TABLE IF NOT EXISTS claim_status_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  category text,
  status_code text,
  entity text,
  message text,
  paid_cents integer,
  next_action text,
  request_276 text,
  response_277 text,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_status_checks_claim_idx ON claim_status_checks (claim_id, checked_at DESC);
