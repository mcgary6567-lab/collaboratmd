-- Attachments may live in an external store (see server/files.ts) instead of the row.
ALTER TABLE claim_attachments ALTER COLUMN data_base64 DROP NOT NULL;
ALTER TABLE claim_attachments ADD COLUMN IF NOT EXISTS storage_key text;

-- Full practice exports prepared in the background and kept for a week.
CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  requested_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'queued',
  storage_key text,
  bytes bigint,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS export_jobs_practice_idx ON export_jobs (practice_id, created_at DESC);
