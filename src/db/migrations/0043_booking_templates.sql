-- Saved column mappings for patient imports, by header name, so next month's file maps itself.
CREATE TABLE IF NOT EXISTS import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  mapping jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_id, name)
);

-- Online booking: whether it is on, the practice's time zone, and each provider's weekly hours.
CREATE TABLE IF NOT EXISTS booking_settings (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  enabled boolean NOT NULL DEFAULT false,
  time_zone text NOT NULL DEFAULT 'America/New_York',
  slot_minutes integer NOT NULL DEFAULT 30,
  min_notice_hours integer NOT NULL DEFAULT 24,
  horizon_days integer NOT NULL DEFAULT 21,
  intro text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  location_id uuid REFERENCES locations(id),
  weekday smallint NOT NULL,
  start_minute integer NOT NULL,
  end_minute integer NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_hours_provider_idx ON provider_hours (provider_id, weekday);

-- A request from the public booking page. It holds its slot until staff confirm (creating the
-- patient and appointment) or decline it; nothing is written to patient records before then.
CREATE TABLE IF NOT EXISTS booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  location_id uuid REFERENCES locations(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob date NOT NULL,
  phone text,
  email text,
  reason text,
  payer_name text,
  member_id text,
  sms_consent boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  appointment_id uuid REFERENCES appointments(id),
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS booking_requests_practice_idx ON booking_requests (practice_id, status, starts_at);
