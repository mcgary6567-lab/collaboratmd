-- A billing company works for many practices with one login. A membership
-- grants a user access to a practice with a role for that practice; the
-- user's own practice_id stays as the practice they land in after login.
CREATE TABLE IF NOT EXISTS practice_memberships (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id),
  role text NOT NULL,                  -- admin | biller | front_desk | readonly
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, practice_id)
);
CREATE INDEX IF NOT EXISTS practice_memberships_practice_idx ON practice_memberships (practice_id);

-- Everyone already has access to their own practice.
INSERT INTO practice_memberships (user_id, practice_id, role)
SELECT id, practice_id, role FROM users
ON CONFLICT (user_id, practice_id) DO NOTHING;
