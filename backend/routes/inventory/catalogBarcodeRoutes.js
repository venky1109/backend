import express from 'express';

import {
  createCatalogBarcode,
  getCatalogBarcodes,
  getCatalogBarcodeByCode,
  updateCatalogBarcode,
  deleteCatalogBarcode,
} from '../../controllers/inventory/catalogBarcodeController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

router.route('/')
  .get(getCatalogBarcodes)
  .post(createCatalogBarcode);

router.get('/code/:code', getCatalogBarcodeByCode);

router.route('/:id')
  .put(updateCatalogBarcode)
  .delete(deleteCatalogBarcode);

export default router;