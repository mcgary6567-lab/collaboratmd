-- Fast code search: word search by full-text index, code prefixes by the primary key range.
CREATE INDEX IF NOT EXISTS icd10_codes_description_fts ON icd10_codes USING gin (to_tsvector('english', description));
CREATE INDEX IF NOT EXISTS hcpcs_codes_description_fts ON hcpcs_codes USING gin (to_tsvector('english', description));

-- Medicare physician fee schedule: RVUs, locality GPCIs and the conversion factor, by year.
CREATE TABLE IF NOT EXISTS mpfs_rvus (
  year integer NOT NULL,
  code text NOT NULL,
  modifier text NOT NULL DEFAULT '',
  status text,
  work_rvu numeric NOT NULL,
  pe_non_facility numeric NOT NULL,
  pe_facility numeric NOT NULL,
  mp_rvu numeric NOT NULL,
  mult_proc text,
  PRIMARY KEY (year, code, modifier)
);
CREATE TABLE IF NOT EXISTS mpfs_localities (
  year integer NOT NULL,
  carrier text NOT NULL,
  locality text NOT NULL,
  name text NOT NULL,
  state text,
  work_gpci numeric NOT NULL,
  pe_gpci numeric NOT NULL,
  mp_gpci numeric NOT NULL,
  PRIMARY KEY (year, carrier, locality)
);
CREATE TABLE IF NOT EXISTS mpfs_years (
  year integer PRIMARY KEY,
  conversion_factor numeric NOT NULL
);
ALTER TABLE practices ADD COLUMN IF NOT EXISTS medicare_carrier text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS medicare_locality text;

-- Medicare Secondary Payer: the reason Medicare pays second (SBR05), the questions asked, and crossovers.
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS msp_type text;
CREATE TABLE IF NOT EXISTS msp_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  answers jsonb NOT NULL,
  medicare_primary boolean NOT NULL,
  msp_type text,
  screened_at timestamptz NOT NULL DEFAULT now(),
  screened_by uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS msp_screenings_patient_idx ON msp_screenings (patient_id, screened_at);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS crossover_payer text;

-- Time-based codes: minutes on the line; anesthesia base units.
ALTER TABLE charges ADD COLUMN IF NOT EXISTS minutes integer;
CREATE TABLE IF NOT EXISTS anesthesia_base_units (
  code text PRIMARY KEY,
  base_units integer NOT NULL
);

-- Saved import mappings.
CREATE TABLE IF NOT EXISTS import_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid REFERENCES practices(id),
  kind text NOT NULL,
  name text NOT NULL,
  mapping jsonb NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Passkeys.
CREATE TABLE IF NOT EXISTS passkeys (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  public_key text NOT NULL,
  algorithm integer NOT NULL,
  sign_count integer NOT NULL DEFAULT 0,
  transports jsonb,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS passkeys_user_idx ON passkeys (user_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL,
  user_id uuid REFERENCES users(id),
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Quality measures reported on claims.
CREATE TABLE IF NOT EXISTS quality_measures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  number text NOT NULL,
  title text NOT NULL,
  eligible_codes jsonb NOT NULL,
  dx_prefixes jsonb NOT NULL DEFAULT '[]',
  min_age integer,
  max_age integer,
  codes jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quality_measures_practice_idx ON quality_measures (practice_id);
