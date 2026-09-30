-- Duplicate patients: the record merged away points at the one kept; who registered a patient or a policy, and how.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES patients(id);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS merged_at timestamptz;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS source text;

-- Why a balance was written off, chosen when it is (timely filing, no authorization, small balance...).
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS write_off_category text;

-- The ledger guard, again: merging a duplicate patient may move its entries to the patient kept, and nothing else changes.
CREATE OR REPLACE FUNCTION ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM practices p WHERE p.id = OLD.practice_id AND p.closing_at IS NOT NULL AND p.closing_at <= now()) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Ledger entries cannot be deleted; post a correcting entry instead';
  END IF;
  IF NEW.practice_id IS NOT DISTINCT FROM OLD.practice_id
     AND (NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
          OR EXISTS (SELECT 1 FROM patients p WHERE p.id = OLD.patient_id AND p.merged_into = NEW.patient_id))
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
     AND NEW.group_code IS NOT DISTINCT FROM OLD.group_code
     AND NEW.reason_code IS NOT DISTINCT FROM OLD.reason_code
     AND NEW.remark_code IS NOT DISTINCT FROM OLD.remark_code
     AND NEW.remittance_id IS NOT DISTINCT FROM OLD.remittance_id
     AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
     AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
     AND NEW.write_off_category IS NOT DISTINCT FROM OLD.write_off_category THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ledger entries cannot be changed; post a correcting entry instead';
END;
$$ LANGUAGE plpgsql;

-- A closed month is locked: nothing can be posted dated into it (post it today instead, or reopen the month).
CREATE OR REPLACE FUNCTION ledger_period_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM period_closes pc
    WHERE pc.practice_id = NEW.practice_id
      AND NEW.posted_at >= to_date(pc.period || '-01', 'YYYY-MM-DD')
      AND NEW.posted_at < (to_date(pc.period || '-01', 'YYYY-MM-DD') + interval '1 month')
  ) THEN
    RAISE EXCEPTION 'That date is in a closed month; post it in the current month, or reopen the month first';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ledger_period_lock ON ledger_entries;
CREATE TRIGGER ledger_period_lock BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_period_lock();

-- A coder's question to the provider about a visit; the claim waits for the answer.
CREATE TABLE IF NOT EXISTS coding_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  encounter_id uuid NOT NULL REFERENCES encounters(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  topic text NOT NULL,
  question text NOT NULL,
  answer text,
  status text NOT NULL DEFAULT 'open',
  asked_by uuid REFERENCES users(id),
  asked_at timestamptz NOT NULL DEFAULT now(),
  answered_by uuid REFERENCES users(id),
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS coding_queries_practice_idx ON coding_queries (practice_id, status);
CREATE INDEX IF NOT EXISTS coding_queries_encounter_idx ON coding_queries (encounter_id);

-- Medicare's yearly therapy threshold (KX) and targeted medical review amount, entered by the platform operator.
CREATE TABLE IF NOT EXISTS therapy_thresholds (
  year integer PRIMARY KEY,
  kx_cents integer NOT NULL,
  review_cents integer,
  entered_by text,
  entered_at timestamptz NOT NULL DEFAULT now()
);

-- Personal injury cases: an attorney's lien or letter of protection holds the patient's balance until settlement.
CREATE TABLE IF NOT EXISTS injury_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  attorney text NOT NULL,
  firm text,
  phone text,
  email text,
  case_number text,
  accident_on date,
  lien_signed_on date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  reduction_requested_cents integer,
  reduction_agreed_cents integer,
  settled_on date,
  settlement_paid_cents integer,
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS injury_cases_practice_idx ON injury_cases (practice_id, status);
CREATE INDEX IF NOT EXISTS injury_cases_patient_idx ON injury_cases (patient_id);

-- Internal coding audits: a sample of each provider's claims, scored against the documentation.
CREATE TABLE IF NOT EXISTS coding_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  per_provider integer NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS coding_audit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES coding_audits(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  result text NOT NULL DEFAULT 'pending',
  finding text,
  billed_code text,
  correct_code text,
  note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS coding_audit_items_audit_idx ON coding_audit_items (audit_id);
