-- Appeal letters drafted for denials: kept as edited, and when sent.
CREATE TABLE IF NOT EXISTS appeal_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  denial_id uuid NOT NULL REFERENCES denials(id),
  body text NOT NULL,
  source text NOT NULL,                -- ai | template
  status text NOT NULL DEFAULT 'draft',-- draft | sent
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS appeal_letters_denial_idx ON appeal_letters (denial_id);

-- Bank deposits imported from the bank's export, matched to remittances.
CREATE TABLE IF NOT EXISTS bank_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  deposit_date date NOT NULL,
  amount_cents integer NOT NULL,
  description text NOT NULL,
  remittance_id uuid REFERENCES remittances(id),
  status text NOT NULL DEFAULT 'unmatched', -- unmatched | matched | ignored
  match_reason text,
  fingerprint text NOT NULL,           -- date|amount|description, so a re-import adds nothing twice
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bank_deposits_fingerprint_idx ON bank_deposits (practice_id, fingerprint);

-- Which payer each provider is enrolled with, and when that lapses.
CREATE TABLE IF NOT EXISTS provider_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  status text NOT NULL DEFAULT 'not_started', -- not_started | submitted | in_process | approved | denied | terminated
  payer_provider_id text,
  submitted_on date,
  effective_on date,
  revalidation_due date,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_enrollments_pair_idx ON provider_enrollments (provider_id, payer_id);

-- Patient accounts past normal statements: final notice, then an agency.
CREATE TABLE IF NOT EXISTS patient_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  stage text NOT NULL,                 -- final_notice | agency | recalled | settled
  amount_cents integer NOT NULL,
  agency text,
  final_notice_at timestamptz,
  placed_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_collections_patient_idx ON patient_collections (patient_id, created_at DESC);
