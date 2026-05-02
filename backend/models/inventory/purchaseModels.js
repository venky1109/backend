import BasePgModel from './BasePgModel.js';

export const PurchaseOrder = new BasePgModel('purchases.purchase_order', [
  'po_number',
  'supplier_id',
  'warehouse_id',
  'order_date',
  'expected_date',
  'arrived_date',
  'remarks',
  'status',
  'total_amount',
  'bill_details',
]);

export const PurchaseOrderItem = new BasePgModel('purchases.purchase_order_items', [
  'purchase_order_id',
  'product_id',
  'brand_id',
  'qty',
  'no_of_units',
  'unit_id',
  'category_id',
  'expected_unit_price',
  'actual_unit_price',
]);