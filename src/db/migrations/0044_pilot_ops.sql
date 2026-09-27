-- The request an error happened in, to find it in the platform's logs.
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS last_request_id text;

-- "Report a problem" from inside the app.
CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid REFERENCES users(id),
  page text NOT NULL,
  message text NOT NULL,
  user_agent text,
  viewport text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);

-- How often each part of the app is used, per practice per day. Counts only.
CREATE TABLE IF NOT EXISTS feature_usage (
  practice_id uuid NOT NULL REFERENCES practices(id),
  feature text NOT NULL,
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (practice_id, feature, day)
);

-- Exports too big for one run are built in parts, one run each.
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS plan jsonb;
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS parts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS next_part integer NOT NULL DEFAULT 0;
