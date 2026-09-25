-- Reports built in the report builder, optionally emailed on a schedule.
-- The email carries totals and a sign-in link, never patient rows.
CREATE TABLE IF NOT EXISTS custom_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  dataset text NOT NULL,             -- claims | denials | payments | charges
  config jsonb NOT NULL,             -- columns, group, range, filters
  schedule text NOT NULL DEFAULT 'none', -- none | weekly | monthly
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_sent_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_reports_practice_idx ON custom_reports (practice_id);
