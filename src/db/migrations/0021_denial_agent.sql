-- What the denial agent prepared for each denial, waiting for a person to
-- approve or dismiss. One proposal per denial.
CREATE TABLE IF NOT EXISTS denial_agent_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  denial_id uuid NOT NULL UNIQUE REFERENCES denials(id),
  action text NOT NULL,          -- appeal | correct_claim | write_off | update_insurance
  title text NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  letter_id uuid REFERENCES appeal_letters(id),
  result_claim_id uuid REFERENCES claims(id),
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'proposed', -- proposed | approved | dismissed
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS denial_agent_items_queue_idx ON denial_agent_items (practice_id, status, priority DESC);
