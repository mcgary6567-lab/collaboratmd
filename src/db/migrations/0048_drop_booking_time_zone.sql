-- The time zone moved to practices (0046); since 2026-09-27 nothing reads or
-- writes this column (the release before this one stopped using it).
ALTER TABLE booking_settings DROP COLUMN IF EXISTS time_zone;
