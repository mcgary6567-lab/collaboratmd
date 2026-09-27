-- Results of the integration doctor: each check, when it ran, and what it found.
CREATE TABLE IF NOT EXISTS integration_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  check_id text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ran_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS integration_checks_practice_idx ON integration_checks (practice_id, check_id, ran_at DESC);
