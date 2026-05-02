import express from 'express';

import {
  DispatchOrder,
  DispatchOrderItem,
} from '../../models/inventory/dispatchModels.js';

import {
  list,
  getById,
  create,
  update,
  remove,
} from '../../controllers/inventory/crudController.js';

import {
  createDispatchWithItems,
} from '../../controllers/inventory/supplyController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

// 🔒 Only ADMIN, STOCK_MANAGER, CASHIER
router.use(protectPOS);
router.use(catalogInventoryAccess);

router
  .route('/orders')
  .get(list(DispatchOrder))
  .post(create(DispatchOrder));

router.post('/orders-with-items', createDispatchWithItems);

router
  .route('/orders/:id')
  .get(getById(DispatchOrder))
  .put(update(DispatchOrder))
  .delete(remove(DispatchOrder));

router
  .route('/items')
  .get(list(DispatchOrderItem))
  .post(create(DispatchOrderItem));

router
  .route('/items/:id')
  .get(getById(DispatchOrderItem))
  .put(update(DispatchOrderItem))
  .delete(remove(DispatchOrderItem));

export default router;