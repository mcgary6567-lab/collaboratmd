-- Biller shifts, for teams working in other time zones (an offshore billing team, an overnight shift).

-- The time zone a person works in; empty means the practice's.
ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone text;

-- Weekly working hours, in the person's own time zone. A shift that ends before it starts runs past midnight.
CREATE TABLE IF NOT EXISTS staff_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  weekday integer NOT NULL, -- 0 Sunday to 6 Saturday, in the person's time zone
  starts_at text NOT NULL, -- HH:MM
  ends_at text NOT NULL, -- HH:MM
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_shifts_user_idx ON staff_shifts (user_id);

-- Vacation, sick days and holidays, as dates in the person's time zone.
CREATE TABLE IF NOT EXISTS staff_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  kind text NOT NULL, -- vacation | sick | holiday | other
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_time_off_user_idx ON staff_time_off (user_id, starts_on);

-- Clocking in and out.
CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  clock_in timestamptz NOT NULL,
  clock_out timestamptz,
  note text
);
CREATE INDEX IF NOT EXISTS time_entries_user_idx ON time_entries (user_id, clock_in);
-- One open entry per person at a time.
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_open_idx ON time_entries (user_id) WHERE clock_out IS NULL;

-- End-of-shift notes for whoever works next.
CREATE TABLE IF NOT EXISTS shift_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  done text,
  in_progress text,
  problems text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_handovers_practice_idx ON shift_handovers (practice_id, created_at);
