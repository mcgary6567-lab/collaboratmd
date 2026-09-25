-- Patient portal links. Like check-in links: a random token stored only as
-- a hash, date-of-birth verification, and a lock after repeated failures.
CREATE TABLE IF NOT EXISTS portal_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'portal', -- portal | pay
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portal_links_patient_idx ON portal_links (patient_id);

-- Online card payments through a processor (Stripe). The ledger entry is
-- posted once, when the processor confirms the payment.
CREATE TABLE IF NOT EXISTS online_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  plan_id uuid REFERENCES payment_plans(id),
  provider text NOT NULL DEFAULT 'stripe',
  provider_ref text,                   -- checkout session or payment intent id
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending', -- pending | paid | failed | expired
  source text NOT NULL,                -- portal | autopay
  ledger_entry_id uuid,
  failure text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS online_payments_ref_idx ON online_payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS online_payments_patient_idx ON online_payments (patient_id, created_at DESC);

-- A card saved with the processor for automatic plan installments. Only the
-- processor references and display details are kept, never card numbers.
CREATE TABLE IF NOT EXISTS saved_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  provider_customer text NOT NULL,
  provider_method text NOT NULL,
  brand text,
  last4 text,
  exp_month integer,
  exp_year integer,
  autopay_plan_id uuid REFERENCES payment_plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE INDEX IF NOT EXISTS saved_cards_patient_idx ON saved_cards (patient_id) WHERE removed_at IS NULL;

-- Consent to be texted (TCPA) and to receive reminders, per patient.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS reminders_opt_out boolean NOT NULL DEFAULT false;

-- Every text and email sent to a patient, with its outcome.
CREATE TABLE IF NOT EXISTS message_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid REFERENCES patients(id),
  channel text NOT NULL,               -- sms | email
  kind text NOT NULL,                  -- appointment_reminder | balance_reminder | pay_link | portal_link | report
  recipient text NOT NULL,
  entity_id uuid,                      -- appointment, statement or plan the message is about
  status text NOT NULL,                -- sent | failed | skipped
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_log_kind_idx ON message_log (practice_id, kind, entity_id);
