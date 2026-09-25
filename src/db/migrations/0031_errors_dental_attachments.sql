-- Server errors, grouped: one row per distinct error, counted. Messages are redacted
-- before they are stored and no request headers or query strings are kept.
CREATE TABLE IF NOT EXISTS error_events (
  fingerprint text PRIMARY KEY,
  message text NOT NULL,
  digest text,
  route_path text,
  route_type text,
  method text,
  path text,
  count integer NOT NULL DEFAULT 1,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS error_events_seen_idx ON error_events (last_seen);

-- Dental service lines (837D): tooth, surfaces and area of the mouth.
ALTER TABLE charges ADD COLUMN IF NOT EXISTS tooth text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS surfaces text;
ALTER TABLE charges ADD COLUMN IF NOT EXISTS oral_cavity text;

-- Documents that support a claim, referenced from the claim by a PWK segment.
CREATE TABLE IF NOT EXISTS claim_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  claim_id uuid NOT NULL REFERENCES claims(id),
  report_type text NOT NULL,       -- PWK01, e.g. OZ support data, RR radiology report, OB operative note
  transmission text NOT NULL,      -- PWK02: FX fax, BM mail, EL electronic, AA available on request
  control_number text NOT NULL,    -- PWK06, the attachment control number the payer matches on
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  data_base64 text NOT NULL,       -- the file, base64 (at most 5 MB before encoding)
  sent_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_attachments_claim_idx ON claim_attachments (claim_id);
