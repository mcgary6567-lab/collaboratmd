-- An API key may read restricted patients only when an administrator allows it;
-- each such read is recorded on the patient's access log.
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS restricted_access boolean NOT NULL DEFAULT false;

-- Patients who want an earlier appointment. A cancelled time is offered to them
-- by text; the first to reply B gets it.
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  -- Only this provider's openings, or any provider's when null.
  provider_id uuid REFERENCES providers(id),
  note text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set when the patient takes an offered time, or staff take them off the list.
  closed_at timestamptz,
  closed_reason text
);
CREATE INDEX IF NOT EXISTS waitlist_entries_open_idx ON waitlist_entries (practice_id, created_at) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_entries_one_open_per_patient ON waitlist_entries (practice_id, patient_id) WHERE closed_at IS NULL;

-- A freed time offered to the waitlist, and who it was offered to.
CREATE TABLE IF NOT EXISTS slot_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  cancelled_appointment_id uuid REFERENCES appointments(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  location_id uuid REFERENCES locations(id),
  type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  filled_at timestamptz,
  filled_patient_id uuid REFERENCES patients(id),
  filled_appointment_id uuid REFERENCES appointments(id)
);
CREATE INDEX IF NOT EXISTS slot_offers_practice_idx ON slot_offers (practice_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS slot_offers_one_per_cancellation ON slot_offers (cancelled_appointment_id) WHERE cancelled_appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS slot_offer_recipients (
  offer_id uuid NOT NULL REFERENCES slot_offers(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  waitlist_entry_id uuid NOT NULL REFERENCES waitlist_entries(id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (offer_id, patient_id)
);
CREATE INDEX IF NOT EXISTS slot_offer_recipients_patient_idx ON slot_offer_recipients (patient_id, sent_at);
