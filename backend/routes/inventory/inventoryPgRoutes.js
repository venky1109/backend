import express from 'express';

import {
  InventoryProduct,
  StockTransaction,
} from '../../models/inventory/inventoryModels.js';

import {
  list,
  getById,
  create,
  update,
  remove,
} from '../../controllers/inventory/crudController.js';

import {
  receivePurchaseOrder,
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


// 📥 Receive PO → Update Stock
router.post('/receive-purchase-order', receivePurchaseOrder);

export default router;