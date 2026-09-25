-- Billing-company invoicing: what a client practice pays for billing services.
CREATE TABLE IF NOT EXISTS client_agreements (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  issuer_name text NOT NULL,
  issuer_address text,
  rate_bps integer NOT NULL,             -- percent of collections, in basis points (650 = 6.5%)
  minimum_cents integer NOT NULL DEFAULT 0,
  include_patient boolean NOT NULL DEFAULT true,
  terms_days integer NOT NULL DEFAULT 30,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  number text NOT NULL,
  period text NOT NULL,                  -- YYYY-MM
  insurance_cents integer NOT NULL,
  patient_cents integer NOT NULL,
  base_cents integer NOT NULL,           -- collections the fee is charged on
  rate_bps integer NOT NULL,
  fee_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',  -- draft | sent | paid | void
  due_date date,
  issuer jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  paid_at timestamptz,
  UNIQUE (practice_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS client_invoices_period_idx ON client_invoices (practice_id, period) WHERE status <> 'void';

-- Accounting: the practice's names for the general-ledger accounts the journal posts to.
CREATE TABLE IF NOT EXISTS accounting_settings (
  practice_id uuid PRIMARY KEY REFERENCES practices(id),
  accounts jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Month-end close: the month's totals frozen, so later changes to that month show up as a difference.
CREATE TABLE IF NOT EXISTS period_closes (
  practice_id uuid NOT NULL REFERENCES practices(id),
  period text NOT NULL,                  -- YYYY-MM
  totals jsonb NOT NULL,
  closed_by uuid REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (practice_id, period)
);

-- Work queues: rules that turn denials and stuck claims into assigned tasks with a due date.
CREATE TABLE IF NOT EXISTS work_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_id uuid NOT NULL REFERENCES practices(id),
  name text NOT NULL,
  kind text NOT NULL,                    -- denials | stalled_claims | rejections
  conditions jsonb NOT NULL DEFAULT '{}',
  assignee_ids jsonb NOT NULL DEFAULT '[]',
  sla_days integer NOT NULL DEFAULT 5,
  priority text NOT NULL DEFAULT 'normal',
  active boolean NOT NULL DEFAULT true,
  next_index integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rule_id uuid REFERENCES work_rules(id);
