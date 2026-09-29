-- Columns the app looks rows up by that had no index, found with the load test.
-- A claim's denials (the claim page, and every report that asks whether a claim was denied).
CREATE INDEX IF NOT EXISTS denials_claim_idx ON denials (claim_id);
-- Corrected and void claims that point at an original.
CREATE INDEX IF NOT EXISTS claims_original_idx ON claims (original_claim_id) WHERE original_claim_id IS NOT NULL;
-- The visit billed for an appointment (missed charges).
CREATE INDEX IF NOT EXISTS encounters_appointment_idx ON encounters (appointment_id) WHERE appointment_id IS NOT NULL;
-- Ledger entries for a charge line (editing a claim's lines).
CREATE INDEX IF NOT EXISTS ledger_charge_idx ON ledger_entries (charge_id) WHERE charge_id IS NOT NULL;
