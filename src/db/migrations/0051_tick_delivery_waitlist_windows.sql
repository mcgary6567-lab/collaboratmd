-- When something last ran, by name: "tick" is the every-five-minutes run started from outside
-- (server/tick.ts). The status page shows it and the daily job alerts if it stops.
CREATE TABLE IF NOT EXISTS heartbeats (
  name text PRIMARY KEY,
  at timestamptz NOT NULL
);

-- Waitlist: the hours of the day a patient can come (clock hours at the practice; null is any).
ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS from_hour smallint;
ALTER TABLE waitlist_entries ADD COLUMN IF NOT EXISTS until_hour smallint;

-- An opening nobody takes is offered again to the next people on the list, in rounds.
ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS rounds integer NOT NULL DEFAULT 1;
ALTER TABLE slot_offers ADD COLUMN IF NOT EXISTS last_round_at timestamptz;
UPDATE slot_offers SET last_round_at = created_at WHERE last_round_at IS NULL;
-- Twilio reported the offer did not reach the phone.
ALTER TABLE slot_offer_recipients ADD COLUMN IF NOT EXISTS undelivered_at timestamptz;

-- Two-factor for administrators and anyone who can export (server/mfa-policy.ts).
ALTER TABLE practices ADD COLUMN IF NOT EXISTS mfa_for_privileged boolean NOT NULL DEFAULT false;

-- Online booking can also ask to join the waitlist: no time, maybe no provider.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'appointment';
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS from_hour smallint;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS until_hour smallint;
ALTER TABLE booking_requests ALTER COLUMN provider_id DROP NOT NULL;
ALTER TABLE booking_requests ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE booking_requests ALTER COLUMN ends_at DROP NOT NULL;

-- Delivery reports arrive by Twilio's message id, which the message log keeps as "sid SM...".
CREATE INDEX IF NOT EXISTS message_log_sms_sid_idx ON message_log (detail) WHERE channel = 'sms';
