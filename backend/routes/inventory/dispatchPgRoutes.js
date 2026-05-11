import express from 'express';

import {
  getDispatchOrders,
  getDispatchOrderById,
  createDispatchOrder,
  updateDispatchOrder,
  updateDispatchOrderItems,
  updateDispatchStatus,
  deleteDispatchOrder,
  receivedDispatchToOutletMongoStock,
} from '../../controllers/inventory/dispatchController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

router.route('/orders').get(getDispatchOrders).post(createDispatchOrder);

router.put('/orders/:id/received-to-outlet', receivedDispatchToOutletMongoStock);

router.route('/orders/:id').get(getDispatchOrderById).put(updateDispatchOrder).delete(deleteDispatchOrder);

router.put('/orders/:id/items', updateDispatchOrderItems);
router.put('/orders/:id/status', updateDispatchStatus);

export default router;