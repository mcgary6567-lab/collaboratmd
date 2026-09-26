-- SAML AuthnRequest IDs we issued, so a response is accepted only in reply to one of ours (InResponseTo), once.
CREATE TABLE IF NOT EXISTS saml_requests (
  id text PRIMARY KEY,
  practice_id uuid REFERENCES practices(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
