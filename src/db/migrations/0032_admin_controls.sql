-- Practice policies (billing rules an administrator sets), menu customization,
-- and "sign everyone out": sessions that began before this moment end.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS policies jsonb NOT NULL DEFAULT '{}';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS hidden_nav jsonb NOT NULL DEFAULT '[]';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;
-- One person's sessions, ended by an administrator.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_revoked_at timestamptz;
