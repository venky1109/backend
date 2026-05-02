import BasePgModel from './BasePgModel.js';

export const InventoryProduct = new BasePgModel('inventory.inventory_products', [
  'id','product_code','product_name','description','sku_id','hsn_code','bar_code','batch_id',
  'category_id','brand_id','fin - json','count_in_stock','stakeholders_id',
  'business_entity_type','warehouse_id','mfg_date','exp_date'
]);

export const StockTransaction = new BasePgModel('inventory.stock_transaction', [
  'product_id','source','destination','ref_type','qty_in','qty_out','balance_qty'
]);
