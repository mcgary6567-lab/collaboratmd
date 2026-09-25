-- Two-factor sign-in with an authenticator app. The secret is stored
-- encrypted with a key derived from AUTH_SECRET; recovery codes only as
-- SHA-256 hashes. The last accepted time step stops a code being replayed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_pending_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_step bigint;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Repeated wrong passwords or codes lock the account for a while.
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
-- A practice can require two-factor for everyone who works in it.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS require_mfa boolean NOT NULL DEFAULT false;
