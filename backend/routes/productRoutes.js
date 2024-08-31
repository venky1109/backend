import express from 'express';
const router = express.Router();
import {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  deleteProductDetail,
  createProductReview,
  getTopProducts,
  updateProductDetail,
  createProductDetail,
  createFinancialDetail,
  getProductsByCategory,
  getCategories,
} from '../controllers/productController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
import checkObjectId from '../middleware/checkObjectId.js';

router.route('/').get(getProducts).post(protect, admin, createProduct);
router.route('/categories').get(getCategories);
router.get('/categories/:category/products', getProductsByCategory);
router.route('/:id/reviews').post(protect, checkObjectId, createProductReview);
router.get('/top', getTopProducts);
router
  .route('/:id')
  .get(checkObjectId, getProductById)
  .put(protect, admin, checkObjectId, updateProduct)
  .delete(protect, admin, checkObjectId, deleteProduct);
router
  .route('/:productId/details/:id')
  .put(protect, admin, checkObjectId, updateProductDetail)
  .delete(protect, admin, checkObjectId, deleteProductDetail); 
router.route('/:id/details').post(protect, checkObjectId,createProductDetail);
router.route('/:productId/details/:id/financials').post(protect,checkObjectId,createFinancialDetail);

  
  


export default router;
