-- Institutional (837I / UB-04) claims alongside professional ones.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_type text NOT NULL DEFAULT 'professional'; -- professional | institutional
-- Type of bill, statement period, admission and discharge details.
ALTER TABLE claims ADD COLUMN IF NOT EXISTS institutional jsonb;
-- Revenue code on facility service lines (the procedure code is optional there).
ALTER TABLE charges ADD COLUMN IF NOT EXISTS revenue_code text;
