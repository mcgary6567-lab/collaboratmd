-- Claim controls: replacement and void references, clearinghouse
-- acknowledgments, payer-specific edits and prior authorizations.

-- A corrected (frequency 7) or void (frequency 8) claim must carry the payer's
-- claim control number for the claim it replaces, in REF*F8, or the payer
-- rejects it. Keep the link and the number that was sent.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS original_claim_id uuid REFERENCES claims(id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS original_payer_claim_number text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS authorization_number text;

-- 999 (syntax) and 277CA (claim-level) acknowledgments as received.
CREATE TABLE IF NOT EXISTS claim_acknowledgments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES claims(id),
  kind text NOT NULL,                 -- 999 | 277CA
  accepted boolean NOT NULL,
  code text,                          -- IK5/AK9 code, or STC category:status
  message text,
  raw text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_acknowledgments_claim_idx ON claim_acknowledgments (claim_id, received_at);

-- Payer-specific edits, evaluated alongside the general scrubber. A null
-- payer applies to every payer; a null code applies to every line.
CREATE TABLE IF NOT EXISTS payer_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  payer_id uuid REFERENCES payers(id),
  kind text NOT NULL,                 -- auth_required | modifier_required | dx_required | max_units | not_covered
  cpt text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'error',
  message text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payer_edits_lookup_idx ON payer_edits (practice_id, payer_id) WHERE active;

-- Prior authorizations on file, so a claim that needs one can be checked
-- before it is sent rather than denied with CARC 197 weeks later.
CREATE TABLE IF NOT EXISTS authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  auth_number text NOT NULL,
  cpts jsonb NOT NULL DEFAULT '[]'::jsonb,
  units_approved integer,
  units_used integer NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_to date NOT NULL,
  status text NOT NULL DEFAULT 'active', -- active | cancelled
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS authorizations_patient_idx ON authorizations (patient_id, payer_id);
