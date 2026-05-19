CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE IF NOT EXISTS catalog.bills (
  id BIGSERIAL PRIMARY KEY,
  bill_number VARCHAR(80) UNIQUE,
  bill_date DATE NOT NULL,
  service_from_date DATE,
  service_to_date DATE,
  due_date DATE,
  organisation_name VARCHAR(255) NOT NULL,
  organisation_type VARCHAR(80) NOT NULL,
  bill_category VARCHAR(80) NOT NULL,
  expense_type VARCHAR(120) NOT NULL,
  transportation_type VARCHAR(80),
  supplier_id BIGINT,
  warehouse_id BIGINT,
  outlet_id BIGINT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(40) NOT NULL DEFAULT 'unpaid',
  notes TEXT,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payments.payments
  ADD COLUMN IF NOT EXISTS bill_id BIGINT,
  ADD COLUMN IF NOT EXISTS expense_type VARCHAR(120),
  ADD COLUMN IF NOT EXISTS expense_category VARCHAR(80),
  ADD COLUMN IF NOT EXISTS organisation_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS organisation_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT,
  ADD COLUMN IF NOT EXISTS warehouse_id BIGINT,
  ADD COLUMN IF NOT EXISTS outlet_id BIGINT,
  ADD COLUMN IF NOT EXISTS service_from_date DATE,
  ADD COLUMN IF NOT EXISTS service_to_date DATE,
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_catalog_bills_bill_date ON catalog.bills (bill_date);
CREATE INDEX IF NOT EXISTS idx_catalog_bills_organisation ON catalog.bills (organisation_name);
CREATE INDEX IF NOT EXISTS idx_catalog_bills_category ON catalog.bills (bill_category, expense_type);
CREATE INDEX IF NOT EXISTS idx_catalog_bills_payment_status ON catalog.bills (payment_status);

CREATE INDEX IF NOT EXISTS idx_payments_payments_bill_id ON payments.payments (bill_id);
CREATE INDEX IF NOT EXISTS idx_payments_payments_expense ON payments.payments (expense_category, expense_type);
