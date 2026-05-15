import asyncHandler from '../../middleware/asyncHandler.js';

import {
  InventoryProduct,
  StockTransaction,
} from '../../models/inventory/inventoryProductModels.js';

export const getInventoryProducts = asyncHandler(async (req, res) => {
  const rows = await InventoryProduct.findAll();

  // console.log('================ INVENTORY PRODUCTS API RESPONSE ================');

  // console.table(
  //   rows.map((row, index) => ({
  //     idx: index,
  //     id: row.id,
  //     product_barcode_id: row.product_barcode_id,
  //     product_code: row.product_code,
  //     product_name: row.product_name,
  //     exp_date: row.exp_date,
  //     mfg_date: row.mfg_date,
  //     no_of_units: row.no_of_units,
  //     warehouse_id: row.warehouse_id,
  //     mk_barcode: row.mk_barcode,
  //     brand_name_english: row.brand_name_english,
  //     category_name_english: row.category_name_english,
  //     unit_short_code: row.unit_short_code,
  //   }))
  // );

  // console.log(
  //   JSON.stringify(
  //     rows.map((row, index) => ({
  //       idx: index,
  //       id: row.id,
  //       exp_date: row.exp_date,
  //       mfg_date: row.mfg_date,
  //     })),
  //     null,
  //     2
  //   )
  // );

  // console.log('================================================================');

  res.json(rows);
});

export const getInventoryProductById = asyncHandler(async (req, res) => {
  const row = await InventoryProduct.findById(req.params.id);

  if (!row) {
    res.status(404);
    throw new Error('Inventory product not found');
  }

  res.json(row);
});

export const createInventoryProduct = asyncHandler(async (req, res) => {
  const row = await InventoryProduct.create(req.body);
  res.status(201).json(row);
});

export const updateInventoryProduct = asyncHandler(async (req, res) => {
  const row = await InventoryProduct.update(req.params.id, req.body);

  if (!row) {
    res.status(404);
    throw new Error('Inventory product not found');
  }

  res.json(row);
});

export const deleteInventoryProduct = asyncHandler(async (req, res) => {
  const deleted = await InventoryProduct.remove(req.params.id);

  if (!deleted) {
    res.status(404);
    throw new Error('Inventory product not found');
  }

  res.json({
    message: 'Inventory product deleted successfully',
    deleted,
  });
});

export const getStockTransactions = asyncHandler(async (req, res) => {
  const rows = await StockTransaction.findAll();
  res.json(rows);
});

export const getStockTransactionById = asyncHandler(async (req, res) => {
  const row = await StockTransaction.findById(req.params.id);

  if (!row) {
    res.status(404);
    throw new Error('Stock transaction not found');
  }

  res.json(row);
});

export const createStockTransaction = asyncHandler(async (req, res) => {
  const row = await StockTransaction.create(req.body);
  res.status(201).json(row);
});

export const updateStockTransaction = asyncHandler(async (req, res) => {
  const row = await StockTransaction.update(req.params.id, req.body);

  if (!row) {
    res.status(404);
    throw new Error('Stock transaction not found');
  }

  res.json(row);
});

export const deleteStockTransaction = asyncHandler(async (req, res) => {
  const deleted = await StockTransaction.remove(req.params.id);

  if (!deleted) {
    res.status(404);
    throw new Error('Stock transaction not found');
  }

  res.json({
    message: 'Stock transaction deleted successfully',
    deleted,
  });
});

export const addVerifiedPurchaseToInventory = asyncHandler(async (req, res) => {
  const result = await InventoryProduct.receiveVerifiedPurchase(
    req.body,
    req.user || {}
  );

  res.status(result.updated_existing ? 200 : 201).json({
    message: result.updated_existing
      ? 'Existing inventory product updated'
      : 'Purchase verified and added to inventory',
    updated_existing: result.updated_existing,
    inventoryProduct: result.inventoryProduct,
    total_price: result.total_price,
    stockTransaction: result.stockTransaction,
  });
});
