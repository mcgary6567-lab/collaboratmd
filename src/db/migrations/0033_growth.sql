-- Clearinghouse polling: where the last poll stopped, and every inbound transaction seen, so none is imported twice.
CREATE TABLE IF NOT EXISTS clearinghouse_polls (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  cursor text,
  last_polled_at timestamptz,
  last_error text,
  eras_imported integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inbound_transactions (
  practice_id uuid NOT NULL REFERENCES practices(id),
  transaction_id text NOT NULL,
  transaction_set text NOT NULL,
  remittance_id uuid REFERENCES remittances(id),
  note text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, transaction_id)
);

-- Self-service password reset: throttled per account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_sent_at timestamptz;
-- Daily email digest of notifications.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_digest boolean NOT NULL DEFAULT false;

-- In-app notifications. user_id null means every administrator of the practice.
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid REFERENCES users(id),
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (practice_id, user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx ON notifications (practice_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Onboarding checklist dismissed.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamptz;
-- Patient financing: the practice's own lender and when to offer it.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS financing jsonb;

-- Pre-visit estimates tied to an appointment, with an optional deposit request.
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS appointment_id uuid REFERENCES appointments(id);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deposit_requested_at timestamptz;

-- Credentialing: licenses, DEA, board certification, malpractice and CAQH attestation per provider.
CREATE TABLE IF NOT EXISTS provider_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  kind text NOT NULL,          -- state_license | dea | board | malpractice | caqh | other
  identifier text,
  state text,
  issued_on date,
  expires_on date,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provider_credentials_expiry_idx ON provider_credentials (practice_id, expires_on);

-- A/R carried over from the practice's previous billing system, worked here until it is collected or written off.
CREATE TABLE IF NOT EXISTS legacy_ar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_name text,
  source_claim_number text,
  date_of_service date,
  billed_cents integer NOT NULL,
  balance_cents integer NOT NULL,
  responsibility text NOT NULL,  -- insurance | patient
  status text NOT NULL DEFAULT 'open', -- open | collected | written_off
  batch text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legacy_ar_practice_idx ON legacy_ar (practice_id, status);

-- FHIR connection to an EHR: patients and finished visits pulled in.
CREATE TABLE IF NOT EXISTS fhir_connections (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  base_url text NOT NULL,
  token_sealed text,
  last_sync_at timestamptz,
  last_result jsonb
);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS fhir_id text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS fhir_id text;
CREATE UNIQUE INDEX IF NOT EXISTS patients_fhir_idx ON patients (practice_id, fhir_id) WHERE fhir_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_fhir_idx ON appointments (practice_id, fhir_id) WHERE fhir_id IS NOT NULL;

-- SAML single sign-on, alongside OpenID Connect.
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS protocol text NOT NULL DEFAULT 'oidc';
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS saml_entry_point text;
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS saml_idp_issuer text;
ALTER TABLE practice_sso ADD COLUMN IF NOT EXISTS saml_idp_cert text;
ALTER TABLE practice_sso ALTER COLUMN issuer DROP NOT NULL;
ALTER TABLE practice_sso ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE practice_sso ALTER COLUMN client_secret_sealed DROP NOT NULL;
