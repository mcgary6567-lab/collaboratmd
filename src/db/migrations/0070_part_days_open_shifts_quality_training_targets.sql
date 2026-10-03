-- Part-day time off: a morning, an afternoon, or set hours on one day.
ALTER TABLE staff_time_off ADD COLUMN IF NOT EXISTS part text NOT NULL DEFAULT 'full'; -- full | am | pm | hours
ALTER TABLE staff_time_off ADD COLUMN IF NOT EXISTS from_time text; -- HH:MM, for part = hours
ALTER TABLE staff_time_off ADD COLUMN IF NOT EXISTS to_time text;

-- Shifts an administrator posts for hours nobody covers; someone claims one and an administrator confirms it.
CREATE TABLE IF NOT EXISTS open_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'open', -- open | claimed | filled | cancelled
  claimed_by uuid REFERENCES users(id),
  claimed_at timestamptz,
  decided_by uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS open_shifts_practice_idx ON open_shifts (practice_id, status, starts_at);
ALTER TABLE shift_changes ADD COLUMN IF NOT EXISTS open_shift_id uuid REFERENCES open_shifts(id);

-- Quality checks of billers' work: a random sample of claims they sent and payments they posted, reviewed by someone else.
CREATE TABLE IF NOT EXISTS work_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  from_date date NOT NULL,
  to_date date NOT NULL,
  per_person integer NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS work_audit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES work_audits(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id),
  kind text NOT NULL, -- claim | posting
  ref_id uuid NOT NULL, -- the claim or the ledger entry
  worker_id uuid NOT NULL REFERENCES users(id),
  reviewer_id uuid REFERENCES users(id),
  result text NOT NULL DEFAULT 'pending', -- pending | correct | error
  finding text,
  note text,
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS work_audit_items_audit_idx ON work_audit_items (audit_id);
CREATE INDEX IF NOT EXISTS work_audit_items_worker_idx ON work_audit_items (practice_id, worker_id);

-- Staff training and certifications: yearly HIPAA training, and certifications such as CPC or CPB, with expiry dates.
CREATE TABLE IF NOT EXISTS staff_training (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  user_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL, -- hipaa | certification | other
  name text NOT NULL,
  completed_on date NOT NULL,
  expires_on date,
  credential_no text,
  attested boolean NOT NULL DEFAULT false, -- signed by the person themselves
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_training_user_idx ON staff_training (user_id, kind);

-- Daily targets per person: claims sent, payments posted, tasks done.
CREATE TABLE IF NOT EXISTS staff_targets (
  user_id uuid NOT NULL REFERENCES users(id),
  metric text NOT NULL, -- claims | postings | tasks
  practice_id uuid NOT NULL REFERENCES practices(id),
  per_day integer NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, metric)
);
