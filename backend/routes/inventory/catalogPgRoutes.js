import express from 'express';
import multer from 'multer';
import {
  Brand,
  Category,
  Product,
  Unit,
  Stakeholder,
  Employee,
  Outlet,
  Warehouse,
  Bill,
} from '../../models/inventory/catalogModels.js';

import {
  list,
  getById,
  create,
  update,
  remove,
} from '../../controllers/inventory/crudController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';
import { uploadBillFile } from '../../middleware/billUploadMiddleware.js';
import { uploadBill } from '../../controllers/inventory/billUploadController.js';
import {
  searchProductImages,
  uploadProductImage,
  uploadProductImageFromUrl,
} from '../../controllers/inventory/catalogImageController.js';
import { searchLegacyProducts } from '../../controllers/inventory/legacyProductController.js';

const router = express.Router();
const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.PRODUCT_IMAGE_SOURCE_MAX_BYTES || 8 * 1024 * 1024),
  },
});


// 🔒 Apply auth + role restriction to ALL routes
router.use(protectPOS);
router.use(catalogInventoryAccess);

router.post('/bills/upload', uploadBillFile, uploadBill);
router.get('/product-images/search', searchProductImages);
router.post('/product-images/upload', productImageUpload.single('image'), uploadProductImage);
router.post('/product-images/upload-from-url', uploadProductImageFromUrl);
router.get('/legacy-products/search', searchLegacyProducts);
router.get('/legacy-products/secondary-suggestions', searchLegacyProducts);

const mountCrud = (path, model) => {
  router.route(path)
    .get(list(model))
    .post(create(model));

  router.route(`${path}/:id`)
    .get(getById(model))
    .put(update(model))
    .delete(remove(model));
};

mountCrud('/brands', Brand);
mountCrud('/categories', Category);
mountCrud('/products', Product);
mountCrud('/units', Unit);
mountCrud('/stakeholders', Stakeholder);
mountCrud('/employees', Employee);
mountCrud('/outlets', Outlet);
mountCrud('/warehouses', Warehouse);
mountCrud('/bills', Bill);

export default router;
