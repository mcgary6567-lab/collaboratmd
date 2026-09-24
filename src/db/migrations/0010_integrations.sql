-- Keys an EHR interface engine uses to post HL7 to /api/hl7. Only a hash is
-- kept; the key is shown once, when it is created. The prefix identifies a
-- key in lists without revealing it.
CREATE TABLE IF NOT EXISTS integration_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Every HL7 message received, with what became of it. The control ID makes
-- a resend idempotent: the same message twice is acknowledged, not applied twice.
CREATE TABLE IF NOT EXISTS integration_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  key_id uuid REFERENCES integration_keys(id),
  source text NOT NULL,                -- api | manual
  message_type text NOT NULL,          -- e.g. ADT^A04
  control_id text NOT NULL,
  status text NOT NULL,                -- processed | error | duplicate
  error text,
  result jsonb,
  raw text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS integration_messages_control_idx ON integration_messages (practice_id, control_id) WHERE status = 'processed';
CREATE INDEX IF NOT EXISTS integration_messages_recent_idx ON integration_messages (practice_id, received_at DESC);

-- File imports (patients from another system's export).
CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  kind text NOT NULL,                  -- patients
  filename text NOT NULL,
  mapping jsonb NOT NULL,
  mapped_by text NOT NULL,             -- rules | ai | user
  total_rows integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
