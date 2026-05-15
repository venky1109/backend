import express from 'express';

import {
  getInventoryDashboardSummary,
  getInventoryDashboardProducts,
  getInventoryDashboardOrders,
  getInventoryDashboardCustomers,
  getInventoryDashboardFinance,
} from '../../controllers/inventory/inventoryDashboardController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

router.get('/summary', getInventoryDashboardSummary);
router.get('/products', getInventoryDashboardProducts);
router.get('/orders', getInventoryDashboardOrders);
router.get('/customers', getInventoryDashboardCustomers);
router.get('/finance', getInventoryDashboardFinance);

export default router;
