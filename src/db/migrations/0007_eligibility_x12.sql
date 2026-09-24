-- Eligibility checks keep the 270 that was sent and the 271 that came back,
-- so a disputed benefit can be traced to exactly what the payer said.
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS service_date date;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS trace_number text;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS request_270 text;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS response_271 text;
ALTER TABLE eligibility_checks ADD COLUMN IF NOT EXISTS message text;
CREATE INDEX IF NOT EXISTS eligibility_checks_insurance_idx ON eligibility_checks (patient_insurance_id, checked_at DESC);
