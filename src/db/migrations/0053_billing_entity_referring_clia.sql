-- Who bills: the practice as an organization (Type 2 NPI, the default), or a solo provider under
-- their own Type 1 NPI, whose name then goes in the billing provider loop (2010AA NM1*85*1).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_entity text NOT NULL DEFAULT 'organization';
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_last_name text;
ALTER TABLE practices ADD COLUMN IF NOT EXISTS billing_first_name text;

-- The practice's CLIA certificate number, sent on claims with laboratory tests (2300 REF*X4).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS clia_number text;

-- The provider who referred the patient, when the payer needs one (2310A NM1*DN).
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referring_last_name text;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referring_first_name text;
ALTER TABLE encounters ADD COLUMN IF NOT EXISTS referring_npi text;

-- The demo practice bills lab tests: a (fictional) CLIA number, so its claims pass the new check.
UPDATE practices SET clia_number = '10D1234567' WHERE is_demo AND clia_number IS NULL;
