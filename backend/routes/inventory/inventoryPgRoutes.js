import express from 'express';

import {
  InventoryProduct,
  StockTransaction,
} from '../../models/inventory/inventoryProductModels.js';

import {
  list,
  getById,
  create,
  update,
  remove,
} from '../../controllers/inventory/crudController.js';

import {
  receivePurchaseOrder,
  addVerifiedPurchaseToInventory,
} from '../../controllers/inventory/supplyController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();


// 🔒 Apply security
router.use(protectPOS);
router.use(catalogInventoryAccess);


// 📦 Inventory Products
router.route('/products')
  .get(list(InventoryProduct))
  .post(create(InventoryProduct));

router.route('/products/:id')
  .get(getById(InventoryProduct))
  .put(update(InventoryProduct))
  .delete(remove(InventoryProduct));


// 🔄 Stock Transactions
router.route('/stock-transactions')
  .get(list(StockTransaction))
  .post(create(StockTransaction));

router.route('/stock-transactions/:id')
  .get(getById(StockTransaction))
  .put(update(StockTransaction))
  .delete(remove(StockTransaction));


// 📥 Receive PO → basic stock update
router.post('/receive-purchase-order', receivePurchaseOrder);

// ✅ Verified PO → inventory product with batch_id, sku_id, exp_date
router.post('/receive-verified-purchase', addVerifiedPurchaseToInventory);

export default router;