import express from 'express';

import {
  PurchaseOrder,
  PurchaseOrderItem,
} from '../../models/inventory/purchaseModels.js';

import {
  list,
  getById,
  create,
  update,
  remove,
} from '../../controllers/inventory/crudController.js';

import {
  createPurchaseOrderWithItems,
  getSupplierProducts,
  getPurchaseOrdersDetailed,
  updatePurchaseOrderItems,
  verifyReceivedPurchaseOrder,
} from '../../controllers/inventory/supplyController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

router
  .route('/orders')
  .get(list(PurchaseOrder))
  .post(create(PurchaseOrder));

router.post('/orders-with-items', createPurchaseOrderWithItems);
router.get('/orders-detailed', getPurchaseOrdersDetailed);
router.put('/orders/:id/items', updatePurchaseOrderItems);
router.put('/orders/:id/verify-received', verifyReceivedPurchaseOrder);

router
  .route('/orders/:id')
  .get(getById(PurchaseOrder))
  .put(update(PurchaseOrder))
  .delete(remove(PurchaseOrder));

router
  .route('/items')
  .get(list(PurchaseOrderItem))
  .post(create(PurchaseOrderItem));

router
  .route('/items/:id')
  .get(getById(PurchaseOrderItem))
  .put(update(PurchaseOrderItem))
  .delete(remove(PurchaseOrderItem));

router.get('/supplier-products/:supplierId', getSupplierProducts);

export default router;