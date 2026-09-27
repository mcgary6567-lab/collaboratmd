-- Operators answer problem reports; the reporter sees the answer in the app.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS reply text;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS replied_at timestamptz;
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS replied_by uuid REFERENCES users(id);

-- Suggestions of features a practice has not tried, and which ones it dismissed.
CREATE TABLE IF NOT EXISTS dismissed_tips (
  practice_id uuid NOT NULL REFERENCES practices(id),
  tip text NOT NULL,
  dismissed_by uuid REFERENCES users(id),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, tip)
);

-- The language a patient reads: statements, reminders and confirmations follow it.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS preferred_language text NOT NULL DEFAULT 'en';
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'en';
