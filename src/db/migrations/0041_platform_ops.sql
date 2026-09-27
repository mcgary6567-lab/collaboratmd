-- Account emails already sent to a practice (welcome, setup nudge, trial ending...), so each goes once.
CREATE TABLE IF NOT EXISTS lifecycle_emails (
  practice_id uuid NOT NULL REFERENCES practices(id),
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, kind)
);

-- Which version of the terms and privacy policy each administrator accepted, and when.
CREATE TABLE IF NOT EXISTS legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  document text NOT NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text
);
CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx ON legal_acceptances (user_id, document, version);

-- Past-due grace and account closure.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS past_due_since timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS closing_at timestamptz;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS closing_requested_by uuid;

-- A record that a practice's data was deleted, kept after the practice is gone (no foreign keys on purpose).
CREATE TABLE IF NOT EXISTS practice_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL,
  practice_name text NOT NULL,
  requested_by_email text,
  requested_at timestamptz,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  rows_deleted integer NOT NULL,
  files_deleted integer NOT NULL
);
