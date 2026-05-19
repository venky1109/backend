import BasePgModel from './BasePgModel.js';


export const CatalogProductBarcode = new BasePgModel(
  'catalog.product_barcodes',
  [
    'product_id',
    'brand_id',
    'category_id',
    'unit_id',
    'quantity',
    'barcode',
    'mk_barcode',
    'is_active',
    'mongo_product_id',
    'mongo_brand_id',
    'mongo_category_id',
    'mongo_financial_id',
    'image_url',
  ]
);
