-- Inbound messages from the public contact form.
--
-- Deliberately outside the practice tenancy: these arrive from visitors who
-- have no account and belong to no practice, so there is no practice_id to
-- scope them by and no foreign key to hang them on.
CREATE TABLE IF NOT EXISTS contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  organization text,
  topic text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new',
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contact_messages_received_idx
  ON contact_messages (received_at DESC);

CREATE INDEX IF NOT EXISTS contact_messages_topic_idx
  ON contact_messages (topic, received_at DESC);
