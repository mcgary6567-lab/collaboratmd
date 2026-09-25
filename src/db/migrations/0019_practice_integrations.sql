-- Outside services a practice connects from the admin screen: clearinghouse,
-- card payments, texting, email and AI. Secrets are encrypted by the
-- application (AES-256-GCM) before they reach this table; settings that are
-- not secret (a from-number, a sender address) are kept readable.
CREATE TABLE IF NOT EXISTS practice_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider text NOT NULL,              -- stedi | stripe | twilio | resend | anthropic
  enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets text,                        -- sealed JSON of the provider's secret fields
  secret_hints jsonb NOT NULL DEFAULT '{}'::jsonb, -- last four characters, for display only
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_message text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS practice_integrations_provider_idx ON practice_integrations (practice_id, provider);
