-- What the daily job does for each practice. Every switch starts off, so
-- nothing is sent to patients until a practice turns it on.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS automation jsonb NOT NULL DEFAULT '{}'::jsonb;

-- One row per practice per run of the daily job, with what it did.
CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  ran_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb NOT NULL,
  error text
);
CREATE INDEX IF NOT EXISTS automation_runs_practice_idx ON automation_runs (practice_id, ran_at DESC);
