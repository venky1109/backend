import express from 'express';
import {
  createPOSProductFromCatalog,
  addFinancialToPOSProduct,
  updatePOSProductFinancial,
  upsertPOSProductFinancialFromAssigner,
  getPOSProductByBarcode,
  getPOSProductByCatalogProductBarcodeId,
} from '../controllers/POSProductController.js';

import { protectPOS, isAdminOrInventory, allowAllRoles } from '../middleware/posAuthMiddleware.js';

const router = express.Router();

// ⛳️ All routes below require valid POS token
router.use(protectPOS);

// Only ADMIN or INVENTORY can create or modify product entries
router.post('/create-from-catalog', isAdminOrInventory, createPOSProductFromCatalog);
router.post('/add-financial', isAdminOrInventory, addFinancialToPOSProduct);
router.post('/barcode-assigner/upsert', isAdminOrInventory, upsertPOSProductFinancialFromAssigner);
router.put('/update-financial', isAdminOrInventory, updatePOSProductFinancial);
router.get(
  '/catalog-product-barcode/:catalogProductBarcodeId',
  protectPOS,
  allowAllRoles,
  getPOSProductByCatalogProductBarcodeId
);
router.get('/mkid/:mkid', protectPOS, allowAllRoles, getPOSProductByCatalogProductBarcodeId);
router.get('/barcode/:barcode', protectPOS, allowAllRoles, getPOSProductByBarcode);
// router.get('/barcode/:barcode', getPOSProductByBarcode);

export default router;
