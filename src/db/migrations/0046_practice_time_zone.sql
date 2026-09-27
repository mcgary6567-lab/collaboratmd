-- The practice's time zone, for "today", "tomorrow" and online booking.
-- Until now it lived only in the booking settings; those values carry over.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/New_York';
UPDATE practices p SET time_zone = s.time_zone FROM booking_settings s WHERE s.practice_id = p.id AND p.time_zone <> s.time_zone;
