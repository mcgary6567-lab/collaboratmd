-- Self-serve signups waiting for their email to be confirmed.
CREATE TABLE IF NOT EXISTS signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  practice_name text NOT NULL,
  plan text,
  password_hash text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  practice_id uuid REFERENCES practices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signups_email_idx ON signups (lower(email), created_at);

-- A practice's own subscription to CollaboratMD (not its patients' payments).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS self_serve boolean NOT NULL DEFAULT false;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'none';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_email text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS stripe_subscription_item_id text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS seats integer;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS claims_reported_through timestamptz;
