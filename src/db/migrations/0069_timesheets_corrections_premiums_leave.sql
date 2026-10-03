-- Corrections to clocked time: asked for by the person, or made by an administrator; every change is in the audit log.
CREATE TABLE IF NOT EXISTS time_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  entry_id uuid REFERENCES time_entries(id) ON DELETE SET NULL, -- empty: a missing entry to add
  clock_in timestamptz NOT NULL,
  clock_out timestamptz NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'requested', -- requested | approved | denied | cancelled
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_corrections_open_idx ON time_corrections (practice_id, status);

-- A person's week (Monday to Sunday in their time zone), submitted by them and approved by an administrator. Approved weeks are locked.
CREATE TABLE IF NOT EXISTS timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  week_start date NOT NULL,
  status text NOT NULL DEFAULT 'submitted', -- submitted | approved
  hours numeric NOT NULL DEFAULT 0, -- hours worked when submitted
  note text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS timesheets_week_idx ON timesheets (user_id, week_start);

-- Premiums on the pay worksheet: a night differential in a local window, and pay for hours worked on a holiday.
ALTER TABLE staff_pay ADD COLUMN IF NOT EXISTS night_pct numeric; -- e.g. 10 for 10% more
ALTER TABLE staff_pay ADD COLUMN IF NOT EXISTS night_start text NOT NULL DEFAULT '22:00';
ALTER TABLE staff_pay ADD COLUMN IF NOT EXISTS night_end text NOT NULL DEFAULT '06:00';
ALTER TABLE staff_pay ADD COLUMN IF NOT EXISTS holiday_multiplier numeric; -- e.g. 2 for double pay

-- Leave allowances per person and kind of time off, per calendar year.
CREATE TABLE IF NOT EXISTS staff_leave (
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL, -- vacation | sick | other
  practice_id uuid NOT NULL REFERENCES practices(id),
  days_per_year numeric NOT NULL,
  accrual text NOT NULL DEFAULT 'upfront', -- upfront | monthly
  carry_over numeric NOT NULL DEFAULT 0, -- days carried into this year
  year integer NOT NULL, -- the year carry_over applies to
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind)
);
