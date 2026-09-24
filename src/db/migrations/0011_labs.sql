-- Lab orders and their results. The placer order number is ours and unique
-- per practice; a lab echoes it in its result so the result finds its order.
CREATE TABLE IF NOT EXISTS lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  patient_id uuid NOT NULL REFERENCES patients(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  lab_code text NOT NULL,
  placer_order_number text NOT NULL,
  filler_order_number text,
  tests jsonb NOT NULL,                -- [{code, name, cpt}]
  diagnoses jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'ordered', -- ordered | partial | resulted | cancelled
  orm_message text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resulted_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS lab_orders_placer_idx ON lab_orders (practice_id, placer_order_number);
CREATE INDEX IF NOT EXISTS lab_orders_patient_idx ON lab_orders (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lab_orders_open_idx ON lab_orders (practice_id, status);

CREATE TABLE IF NOT EXISTS lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES lab_orders(id),
  practice_id uuid NOT NULL REFERENCES practices(id),
  test_code text NOT NULL,
  loinc text NOT NULL,
  name text NOT NULL,
  value text NOT NULL,
  units text,
  reference_range text,
  flag text,                           -- HL7 0078: L, H, LL, HH, A, N
  status text NOT NULL DEFAULT 'F',    -- F final, P preliminary, C corrected
  observed_at date,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lab_results_order_idx ON lab_results (order_id);
