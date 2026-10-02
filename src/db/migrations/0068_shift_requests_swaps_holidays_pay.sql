-- Time off is requested and approved; entries made before this are approved.
ALTER TABLE staff_time_off ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved'; -- requested | approved | denied
ALTER TABLE staff_time_off ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES users(id);
ALTER TABLE staff_time_off ADD COLUMN IF NOT EXISTS decided_at timestamptz;

-- A task moved to a teammate for someone's time off, so it can go back if the time off is cancelled.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS moved_from uuid REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS moved_for uuid REFERENCES staff_time_off(id);

-- The holiday calendar a person follows: US, PH, PK, IN (or none).
ALTER TABLE users ADD COLUMN IF NOT EXISTS holiday_calendar text;

-- Holidays a calendar cannot compute (Eid, Diwali and other lunar or proclaimed dates), and company holidays.
CREATE TABLE IF NOT EXISTS staff_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  calendar text NOT NULL, -- US | PH | PK | IN | COMPANY
  on_date date NOT NULL,
  name text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_holidays_day_idx ON staff_holidays (practice_id, calendar, on_date);

-- One-off changes to the weekly hours, as real moments: extra hours, or weekly hours cancelled (from an approved swap).
CREATE TABLE IF NOT EXISTS shift_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL, -- extra | cancel
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  swap_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shift_changes_user_idx ON shift_changes (user_id, starts_at);

-- A biller asks a teammate to take one of their shifts; the teammate accepts; an administrator approves.
CREATE TABLE IF NOT EXISTS shift_swaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  requester_id uuid NOT NULL REFERENCES users(id),
  taker_id uuid NOT NULL REFERENCES users(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'requested', -- requested | accepted | approved | declined | denied | cancelled
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unpaid breaks inside a clocked shift.
CREATE TABLE IF NOT EXISTS time_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS time_breaks_open_idx ON time_breaks (entry_id) WHERE ends_at IS NULL;

-- Where a clock-in came from, checked against the practice's office networks.
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS off_network boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS clock_settings (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  networks jsonb NOT NULL DEFAULT '[]'::jsonb, -- addresses or CIDR ranges
  mode text NOT NULL DEFAULT 'flag', -- flag | require
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pay for the pay worksheet: an hourly rate in the person's currency, and overtime rules.
CREATE TABLE IF NOT EXISTS staff_pay (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  rate_cents integer NOT NULL, -- per hour, in minor units of the currency
  currency text NOT NULL DEFAULT 'USD',
  weekly_ot_hours numeric, -- overtime after this many hours in a week
  daily_ot_hours numeric, -- overtime after this many hours in a day
  ot_multiplier numeric NOT NULL DEFAULT 1.5,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
