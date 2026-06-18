import express from 'express';
import {
  createPOSProductFromCatalog,
  addFinancialToPOSProduct,
  updatePOSProductFinancial,
  upsertPOSProductFinancialFromAssigner,
  lookupBarcodeAssignerProduct,
  getBarcodeAssignerNameSuggestions,
  getBarcodeAssignerCatalogBarcodeById,
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
router.get('/barcode-assigner/lookup', isAdminOrInventory, lookupBarcodeAssignerProduct);
router.get('/barcode-assigner/name-suggestions', isAdminOrInventory, getBarcodeAssignerNameSuggestions);
router.get('/barcode-assigner/catalog-barcode/:catalogProductBarcodeId', isAdminOrInventory, getBarcodeAssignerCatalogBarcodeById);
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
