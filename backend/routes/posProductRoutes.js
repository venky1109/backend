import express from 'express';
import {
  createPOSProductFromCatalog,
  addFinancialToPOSProduct,
  updatePOSProductFinancial,
  upsertPOSProductFinancialFromAssigner,
  lookupBarcodeAssignerProduct,
  getBarcodeAssignerNameSuggestions,
  getBarcodeAssignerCategorySuggestions,
  getBarcodeAssignerBrandSuggestions,
  getBarcodeAssignerCatalogBarcodeById,
  previewBarcodeAssignerMkBarcode,
  getBarcodeAssignerSyncData,
  getPOSProductByBarcode,
  getPOSProductByCatalogProductBarcodeId,
  generateBarcodeAssignerMkBarcode,
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
router.get('/barcode-assigner/category-suggestions', isAdminOrInventory, getBarcodeAssignerCategorySuggestions);
router.get('/barcode-assigner/brand-suggestions', isAdminOrInventory, getBarcodeAssignerBrandSuggestions);
router.get('/barcode-assigner/sync-data', isAdminOrInventory, getBarcodeAssignerSyncData);
router.get('/barcode-assigner/catalog-barcode/:catalogProductBarcodeId', isAdminOrInventory, getBarcodeAssignerCatalogBarcodeById);
router.post('/barcode-assigner/mk-barcode/preview', isAdminOrInventory, previewBarcodeAssignerMkBarcode);
router.post('/barcode-assigner/mk-barcode/generate', isAdminOrInventory, generateBarcodeAssignerMkBarcode);
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
