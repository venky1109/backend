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
  ]
);