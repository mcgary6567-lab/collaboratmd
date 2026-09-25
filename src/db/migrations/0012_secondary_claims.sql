-- Secondary billing. A claim to the patient's second insurer carries the
-- first insurer's adjudication (payer sequence S) and points at the primary
-- claim. Money the secondary pays posts to the primary claim, so charges are
-- counted once and the balance stays on one claim.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS payer_sequence text NOT NULL DEFAULT 'P';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS primary_claim_id uuid REFERENCES claims(id);
CREATE INDEX IF NOT EXISTS claims_primary_idx ON claims (primary_claim_id) WHERE primary_claim_id IS NOT NULL;
