-- Deactivated users keep their history but cannot sign in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- Practice sign-in policy: how long a session lasts, and where sign-in is allowed from.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS session_hours integer NOT NULL DEFAULT 12;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS ip_allowlist jsonb NOT NULL DEFAULT '[]';

-- Custom roles: a built-in role with some abilities switched off. users.role and
-- practice_memberships.role hold 'custom:<id>' for someone given one.
CREATE TABLE IF NOT EXISTS custom_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  base_role text NOT NULL,          -- admin | biller | front_desk | readonly
  denied jsonb NOT NULL DEFAULT '[]', -- capability keys switched off
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, name)
);

-- Single sign-on (OpenID Connect) and SCIM provisioning, per practice.
CREATE TABLE IF NOT EXISTS practice_sso (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  issuer text NOT NULL,
  client_id text NOT NULL,
  client_secret_sealed text NOT NULL,
  domains jsonb NOT NULL DEFAULT '[]',   -- email domains that sign in here
  enforce boolean NOT NULL DEFAULT false, -- passwords refused for those domains
  auto_provision boolean NOT NULL DEFAULT false,
  default_role text NOT NULL DEFAULT 'readonly',
  scim_token_hash text,
  scim_token_hint text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
