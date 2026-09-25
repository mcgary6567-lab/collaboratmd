-- Keys for the public REST API (/api/v1). Only a SHA-256 hash is kept; the
-- key itself is shown once, when it is created.
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scope text NOT NULL DEFAULT 'read', -- read | write (write includes read)
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_practice_idx ON api_keys (practice_id);

-- Where a practice wants events sent. The signing secret is sealed by the
-- application because it is needed in the clear to sign each delivery.
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  url text NOT NULL,
  description text,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  secret text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_endpoints_practice_idx ON webhook_endpoints (practice_id);

-- One row per event per endpoint, retried with backoff until delivered or
-- given up on.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | delivered | failed
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx ON webhook_deliveries (endpoint_id, created_at DESC);
