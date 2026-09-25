-- Electronic prior authorization requests (X12 278) and the payer's answers.
-- An approval also creates an authorizations row, which claims and the
-- scrubber already use.
CREATE TABLE IF NOT EXISTS auth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  cpts jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnoses jsonb NOT NULL DEFAULT '[]'::jsonb,
  units integer NOT NULL DEFAULT 1,
  service_from date NOT NULL,
  service_to date NOT NULL,
  status text NOT NULL,              -- approved | partial | denied | pended | not_required | cancelled | error
  auth_number text,
  valid_from date,
  valid_to date,
  message text,
  authorization_id uuid REFERENCES authorizations(id),
  request_278 text NOT NULL,
  response_278 text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_requests_patient_idx ON auth_requests (patient_id, created_at DESC);
