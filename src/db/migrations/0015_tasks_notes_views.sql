-- Work assignment: a task can point at a claim, denial or patient, has an
-- assignee and a due date, and is closed when done.
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  title text NOT NULL,
  entity_type text,                    -- claim | denial | patient
  entity_id uuid,
  assignee_id uuid REFERENCES users(id),
  created_by uuid REFERENCES users(id),
  due_date date,
  priority text NOT NULL DEFAULT 'normal', -- normal | high
  status text NOT NULL DEFAULT 'open',     -- open | done
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks (assignee_id, status, due_date);
CREATE INDEX IF NOT EXISTS tasks_practice_idx ON tasks (practice_id, status);
CREATE INDEX IF NOT EXISTS tasks_entity_idx ON tasks (entity_type, entity_id);

-- Free-text notes on a claim, denial or patient, shown on its timeline.
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  user_id uuid REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_entity_idx ON notes (entity_type, entity_id, created_at DESC);

-- A user's named filters on a list page.
CREATE TABLE IF NOT EXISTS saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  practice_id uuid NOT NULL REFERENCES practices(id),
  page text NOT NULL,                  -- claims | patients | denials
  name text NOT NULL,
  query text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_views_user_idx ON saved_views (user_id, page);
