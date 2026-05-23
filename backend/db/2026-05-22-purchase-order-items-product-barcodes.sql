ALTER TABLE purchases.purchase_order_items
  ADD COLUMN IF NOT EXISTS product_barcode_id BIGINT;

UPDATE purchases.purchase_order_items poi
SET product_barcode_id = pb.id
FROM catalog.product_barcodes pb
WHERE poi.product_barcode_id IS NULL
  AND pb.product_id = poi.product_id
  AND pb.brand_id = poi.brand_id
  AND pb.category_id = poi.category_id
  AND pb.unit_id = poi.unit_id
  AND pb.quantity::numeric = poi.qty::numeric
  AND COALESCE(pb.is_active, true) = true;

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product_barcode_id
  ON purchases.purchase_order_items (product_barcode_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_product_barcodes_purchase_item_match'
      AND conrelid = 'catalog.product_barcodes'::regclass
  ) THEN
    ALTER TABLE catalog.product_barcodes
      ADD CONSTRAINT uq_product_barcodes_purchase_item_match
      UNIQUE (id, product_id, brand_id, category_id, unit_id, quantity);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_order_items_product_barcode'
      AND conrelid = 'purchases.purchase_order_items'::regclass
  ) THEN
    ALTER TABLE purchases.purchase_order_items
      ADD CONSTRAINT fk_purchase_order_items_product_barcode
      FOREIGN KEY (product_barcode_id)
      REFERENCES catalog.product_barcodes (id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_purchase_order_items_product_barcode_match'
      AND conrelid = 'purchases.purchase_order_items'::regclass
  ) THEN
    ALTER TABLE purchases.purchase_order_items
      ADD CONSTRAINT fk_purchase_order_items_product_barcode_match
      FOREIGN KEY (
        product_barcode_id,
        product_id,
        brand_id,
        category_id,
        unit_id,
        qty
      )
      REFERENCES catalog.product_barcodes (
        id,
        product_id,
        brand_id,
        category_id,
        unit_id,
        quantity
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM purchases.purchase_order_items
    WHERE product_barcode_id IS NULL
  ) THEN
    ALTER TABLE purchases.purchase_order_items
      ALTER COLUMN product_barcode_id SET NOT NULL;
  END IF;
END $$;
