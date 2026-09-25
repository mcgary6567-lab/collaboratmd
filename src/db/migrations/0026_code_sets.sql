-- National code-set edits, loaded from CMS's published files by the platform
-- operator. Shared by every practice: the rules are the same for everyone.

-- NCCI procedure-to-procedure edits: column 2 is not paid with column 1 on
-- the same day unless the modifier indicator allows a bypass modifier.
CREATE TABLE IF NOT EXISTS ncci_ptp (
  column1 text NOT NULL,
  column2 text NOT NULL,
  effective date NOT NULL,
  deletion date,
  modifier_indicator text NOT NULL, -- 0 never bypassed, 1 bypass with an NCCI modifier, 9 not applicable
  rationale text,
  PRIMARY KEY (column1, column2, effective)
);
CREATE INDEX IF NOT EXISTS ncci_ptp_column2_idx ON ncci_ptp (column2);

-- Medically unlikely edits: the most units of a code one patient gets on one day.
CREATE TABLE IF NOT EXISTS ncci_mue (
  code text PRIMARY KEY,
  max_units integer NOT NULL,
  adjudication_indicator text, -- 1 line, 2 date of service (policy), 3 date of service (clinical)
  rationale text
);

-- Medicare coverage policies (LCD articles / NCDs): which diagnoses support a procedure.
CREATE TABLE IF NOT EXISTS coverage_policy_codes (
  policy_id text NOT NULL,
  title text NOT NULL,
  cpt text NOT NULL,
  icd10 text NOT NULL,
  PRIMARY KEY (policy_id, cpt, icd10)
);
CREATE INDEX IF NOT EXISTS coverage_policy_codes_cpt_idx ON coverage_policy_codes (cpt);

-- What was loaded, when and by whom.
CREATE TABLE IF NOT EXISTS code_set_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_set text NOT NULL, -- ncci_ptp | ncci_mue | coverage
  label text NOT NULL,
  rows integer NOT NULL,
  loaded_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Rule suggestions a practice chose not to adopt, so they stop being suggested.
CREATE TABLE IF NOT EXISTS rule_suggestion_dismissals (
  practice_id uuid NOT NULL REFERENCES practices(id),
  suggestion_key text NOT NULL,
  dismissed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, suggestion_key)
);
