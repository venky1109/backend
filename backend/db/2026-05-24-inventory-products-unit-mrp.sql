ALTER TABLE inventory.inventory_products
ADD COLUMN IF NOT EXISTS unit_mrp numeric(20, 2) NOT NULL DEFAULT 0;
