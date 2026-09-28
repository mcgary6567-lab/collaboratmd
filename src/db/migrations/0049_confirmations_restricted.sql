-- A patient confirming an appointment by replying to the reminder text.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_via text;

-- Restricted patients ("break the glass"): opening their records asks for a
-- reason, which is recorded and sent to the administrators.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS restricted boolean NOT NULL DEFAULT false;
