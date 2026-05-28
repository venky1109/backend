CREATE TABLE IF NOT EXISTS catalog.rate_plans (
  id BIGSERIAL PRIMARY KEY,
  product_barcode_id BIGINT NOT NULL
    REFERENCES catalog.product_barcodes(id) ON DELETE CASCADE,
  rate_for TEXT NOT NULL DEFAULT 'customer',
  gst_rate NUMERIC(8, 2) NOT NULL DEFAULT 0,
  margin_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
  labour_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
  transport_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
  load_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
  unload_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_rate_plans_product_barcode_id
  ON catalog.rate_plans(product_barcode_id);

ALTER TABLE catalog.rate_plans
ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(8, 2) NOT NULL DEFAULT 0;

ALTER TABLE catalog.rate_plans
ADD COLUMN IF NOT EXISTS rate_for TEXT NOT NULL DEFAULT 'customer';

ALTER TABLE catalog.rate_plans
DROP COLUMN IF EXISTS package_amount;

ALTER TABLE catalog.rate_plans
DROP COLUMN IF EXISTS mrp_amount;

ALTER TABLE catalog.rate_plans
DROP CONSTRAINT IF EXISTS rate_plans_product_barcode_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_rate_plans_barcode_rate_for
  ON catalog.rate_plans(product_barcode_id, lower(rate_for));
