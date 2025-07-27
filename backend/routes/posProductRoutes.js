import express from 'express';
import {
  createPOSProductFromCatalog,
  addFinancialToPOSProduct,
  updatePOSProductFinancial,
    getPOSProductByBarcode
} from '../controllers/POSProductController.js';

import { protectPOS, isAdminOrInventory, allowAllRoles } from '../middleware/posAuthMiddleware.js';

const router = express.Router();

// ⛳️ All routes below require valid POS token
router.use(protectPOS);

// Only ADMIN or INVENTORY can create or modify product entries
router.post('/create-from-catalog', isAdminOrInventory, createPOSProductFromCatalog);
router.post('/add-financial', isAdminOrInventory, addFinancialToPOSProduct);
router.put('/update-financial', isAdminOrInventory, updatePOSProductFinancial);
router.get('/barcode/:barcode', protectPOS, allowAllRoles, getPOSProductByBarcode);

export default router;
