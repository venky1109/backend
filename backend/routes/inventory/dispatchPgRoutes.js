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
  receivedDispatchByStakeholder,
  dispatchInternalPackingOrder,
} from '../../controllers/inventory/dispatchController.js';
import { rollbackDispatch } from '../../controllers/inventory/rollbackController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

router.route('/orders').get(getDispatchOrders).post(createDispatchOrder);

router.put('/orders/:id/received-to-outlet', receivedDispatchToOutletMongoStock);
router.put('/orders/:id/received-by-stakeholder', receivedDispatchByStakeholder);
router.put('/orders/:id/received-to-stakeholder', receivedDispatchByStakeholder);
router.put('/orders/:id/internal-packing-dispatched', dispatchInternalPackingOrder);
router.put('/orders/:id/rollback', rollbackDispatch);

router.route('/orders/:id').get(getDispatchOrderById).put(updateDispatchOrder).delete(deleteDispatchOrder);

router.put('/orders/:id/items', updateDispatchOrderItems);
router.put('/orders/:id/status', updateDispatchStatus);

export default router;
