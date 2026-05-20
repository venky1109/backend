import express from 'express';

import {
  previewProductRollback,
  rollbackProductMigration,
} from '../../controllers/inventory/migrationController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

router.post('/product-rollback/preview', previewProductRollback);
router.post('/product-rollback', rollbackProductMigration);

export default router;
