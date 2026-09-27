-- The audit log had no index but its key: the audit page, retention and the
-- per-patient access log (server/access-log.ts) would read the whole table.
CREATE INDEX IF NOT EXISTS audit_log_practice_at_idx ON audit_log (practice_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_practice_entity_idx ON audit_log (practice_id, entity_id, at DESC);
