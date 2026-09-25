-- Periodic user access reviews: who looked, when, and what they concluded.
CREATE TABLE IF NOT EXISTS access_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  reviewed_by uuid REFERENCES users(id),
  users_reviewed integer NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_reviews_practice_idx ON access_reviews (practice_id, created_at DESC);

-- Vendors that touch the practice's data, and whether a business associate
-- agreement (BAA) is in place. Recorded by the practice; nothing here is
-- assumed about a vendor's willingness to sign one.
CREATE TABLE IF NOT EXISTS vendor_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  vendor text NOT NULL,
  service text NOT NULL,
  handles_phi boolean NOT NULL DEFAULT true,
  baa_status text NOT NULL DEFAULT 'not_recorded', -- signed | pending | not_needed | not_recorded
  signed_on date,
  notes text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_agreements_vendor_idx ON vendor_agreements (practice_id, vendor);
