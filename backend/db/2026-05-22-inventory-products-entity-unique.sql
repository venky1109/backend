ALTER TABLE inventory.inventory_products
DROP CONSTRAINT IF EXISTS uq_inventory_product_barcode_warehouse_supplier;

ALTER TABLE inventory.inventory_products
ADD CONSTRAINT uq_inventory_product_barcode_warehouse_supplier_entity
UNIQUE (
  product_barcode_id,
  warehouse_id,
  supplier_id,
  business_entity_type
);

