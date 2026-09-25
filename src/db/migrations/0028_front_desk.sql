-- Two-way texting: every text in or out, threaded by the patient's number.
CREATE TABLE IF NOT EXISTS sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid REFERENCES patients(id),
  direction text NOT NULL,            -- in | out
  phone text NOT NULL,                -- the patient's number, E.164
  body text NOT NULL,
  twilio_sid text,
  status text NOT NULL DEFAULT 'received', -- received | sent | failed
  read_at timestamptz,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_thread_idx ON sms_messages (practice_id, phone, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS sms_messages_sid_idx ON sms_messages (twilio_sid) WHERE twilio_sid IS NOT NULL;

-- Numbers that replied STOP. Nothing is texted to them until they reply START.
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  practice_id uuid NOT NULL REFERENCES practices(id),
  phone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, phone)
);

-- Coverage discovery: eligibility searches by name and date of birth for patients with no insurance on file.
CREATE TABLE IF NOT EXISTS coverage_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  payer_id uuid NOT NULL REFERENCES payers(id),
  status text NOT NULL,               -- found | not_found | error
  member_id text,
  plan_name text,
  message text,
  added_insurance_id uuid REFERENCES patient_insurances(id),
  checked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS coverage_searches_patient_idx ON coverage_searches (practice_id, patient_id, created_at);
