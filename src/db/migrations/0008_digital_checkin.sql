-- Digital check-in: a link sent to the patient before the visit. The token
-- itself is never stored, only its SHA-256, so a database read does not yield
-- working links. Opening the link shows nothing about the patient until the
-- date of birth is confirmed, and repeated wrong answers lock it.
CREATE TABLE IF NOT EXISTS checkin_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  verified_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_links_appointment_idx ON checkin_links (appointment_id);

-- What the patient submitted. Changes are held for staff review rather than
-- written straight into the chart.
CREATE TABLE IF NOT EXISTS checkin_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  link_id uuid NOT NULL REFERENCES checkin_links(id),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  demographics jsonb NOT NULL,
  insurance jsonb NOT NULL,
  consents jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', -- pending | applied | dismissed
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkin_submissions_pending_idx ON checkin_submissions (practice_id, status, created_at);
