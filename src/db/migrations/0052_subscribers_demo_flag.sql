-- A patient's appointments: whether someone on the waitlist is already booked at an opening's time
-- (server/waitlist.ts), their next visit when they reply C or X (server/sms-inbox.ts), and the access
-- review. Found by the load test's missing-index check.
CREATE INDEX IF NOT EXISTS appointments_patient_idx ON appointments (patient_id, starts_at);

-- The insured person, when it is not the patient (a child on a parent's plan, a spouse): the 837
-- sends them as the subscriber and the patient in loop 2000C (lib/edi/subscriber.ts).
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_first_name text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_last_name text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_dob date;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_sex text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_address1 text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_city text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_state text;
ALTER TABLE patient_insurances ADD COLUMN IF NOT EXISTS subscriber_zip text;

-- The demo practice (seeded, with published sign-ins): the only one the public pages may read
-- from, and the one "Try the demo" signs into.
ALTER TABLE practices ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
UPDATE practices SET is_demo = true WHERE id IN (SELECT practice_id FROM users WHERE email = 'admin@collaboratmd.local');

-- The demo practice's Medicare patients get MBI-shaped member IDs, which the scrubber now requires
-- for Medicare (lib/scrub/rules.ts MEDICARE_MBI). Only the demo practice's rows are touched.
UPDATE patient_insurances pi
SET member_id = (1 + abs(hashtext(pi.id::text)) % 9)::text || 'EG' || (abs(hashtext(pi.id::text)) % 10)::text || 'TE'
  || ((abs(hashtext(pi.id::text)) / 10) % 10)::text || 'MK' || (10 + abs(hashtext(pi.id::text)) % 90)::text
FROM payers p, patients pt
WHERE p.id = pi.payer_id AND p.type = 'medicare' AND pt.id = pi.patient_id
  AND pt.practice_id IN (SELECT id FROM practices WHERE is_demo)
  AND upper(replace(pi.member_id, '-', '')) !~ '^[1-9][AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9][AC-HJKMNP-RT-Y][0-9AC-HJKMNP-RT-Y][0-9][AC-HJKMNP-RT-Y]{2}[0-9]{2}$';
