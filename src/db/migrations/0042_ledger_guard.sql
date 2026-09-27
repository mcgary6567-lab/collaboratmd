-- Posted money is never edited: corrections post new entries. The application
-- follows that rule; this makes the database enforce it too, so a bug or a
-- stray query cannot rewrite history.
--
-- Allowed: re-linking an entry to a corrected claim or a replaced charge line
-- (claim_id, charge_id), which moves no money; and deleting a practice's
-- entries once its scheduled closure date has passed (Settings > Close account).
-- A database owner can still disable the trigger; this guards the application,
-- not against someone with full database access.
CREATE OR REPLACE FUNCTION ledger_entries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM practices p WHERE p.id = OLD.practice_id AND p.closing_at IS NOT NULL AND p.closing_at <= now()) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Ledger entries cannot be deleted; post a correcting entry instead';
  END IF;
  IF NEW.practice_id IS NOT DISTINCT FROM OLD.practice_id
     AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.type IS NOT DISTINCT FROM OLD.type
     AND NEW.amount_cents IS NOT DISTINCT FROM OLD.amount_cents
     AND NEW.group_code IS NOT DISTINCT FROM OLD.group_code
     AND NEW.reason_code IS NOT DISTINCT FROM OLD.reason_code
     AND NEW.remark_code IS NOT DISTINCT FROM OLD.remark_code
     AND NEW.remittance_id IS NOT DISTINCT FROM OLD.remittance_id
     AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
     AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Ledger entries cannot be changed; post a correcting entry instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_guard ON ledger_entries;
CREATE TRIGGER ledger_entries_guard BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_guard();
