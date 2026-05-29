import express from 'express';

import {
  getInventoryProducts,
  getInventoryProductById,
  createInventoryProduct,
  updateInventoryProduct,
  deleteInventoryProduct,
  getStockTransactions,
  getStockTransactionById,
  createStockTransaction,
  updateStockTransaction,
  deleteStockTransaction,
  addVerifiedPurchaseToInventory,
} from '../../controllers/inventory/inventoryProductController.js';

import {
  receivePurchaseOrder,
} from '../../controllers/inventory/supplyController.js';
import { rollbackPurchaseInventory } from '../../controllers/inventory/rollbackController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

// 📦 Inventory Products
router
  .route('/products')
  .get(getInventoryProducts)
  .post(createInventoryProduct);

router
  .route('/products/:id')
  .get(getInventoryProductById)
  .put(updateInventoryProduct)
  .delete(deleteInventoryProduct);

// 🔄 Stock Transactions
router
  .route('/stock-transactions')
  .get(getStockTransactions)
  .post(createStockTransaction);

router
  .route('/stock-transactions/:id')
  .get(getStockTransactionById)
  .put(updateStockTransaction)
  .delete(deleteStockTransaction);

// 📥 Receive PO → basic stock update
router.post('/receive-purchase-order', receivePurchaseOrder);

// ✅ Verified PO → inventory product with batch_id, sku_id, exp_date
router.post('/receive-verified-purchase', addVerifiedPurchaseToInventory);
router.put('/rollback-purchase/:id', rollbackPurchaseInventory);

export default router;
