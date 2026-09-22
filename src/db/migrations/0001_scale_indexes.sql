-- Indexes for practice-scale data (hundreds of thousands of claims).
-- Postgres does not index foreign keys automatically, and the dashboards
-- aggregate the ledger by type and posting date.

CREATE INDEX IF NOT EXISTS ledger_practice_type_posted_idx ON ledger_entries (practice_id, type, posted_at);
CREATE INDEX IF NOT EXISTS ledger_practice_posted_idx ON ledger_entries (practice_id, posted_at);

CREATE INDEX IF NOT EXISTS claims_practice_created_idx ON claims (practice_id, created_at);
CREATE INDEX IF NOT EXISTS claims_payer_idx ON claims (payer_id);
CREATE INDEX IF NOT EXISTS claims_encounter_idx ON claims (encounter_id);
CREATE INDEX IF NOT EXISTS claims_patient_idx ON claims (patient_id);

CREATE INDEX IF NOT EXISTS charges_encounter_idx ON charges (encounter_id);

CREATE INDEX IF NOT EXISTS encounters_practice_dos_idx ON encounters (practice_id, date_of_service);
CREATE INDEX IF NOT EXISTS encounters_provider_idx ON encounters (provider_id);
CREATE INDEX IF NOT EXISTS encounters_patient_idx ON encounters (patient_id);

CREATE INDEX IF NOT EXISTS claim_events_claim_idx ON claim_events (claim_id, at);

CREATE INDEX IF NOT EXISTS denials_practice_status_idx ON denials (practice_id, status);
CREATE INDEX IF NOT EXISTS denials_assigned_idx ON denials (assigned_to, status);
CREATE INDEX IF NOT EXISTS denials_practice_created_idx ON denials (practice_id, created_at);

CREATE INDEX IF NOT EXISTS patient_insurances_patient_idx ON patient_insurances (patient_id);
