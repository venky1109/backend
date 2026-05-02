import express from 'express';
import {
  authUser,
  getUserByPhoneNo,
  registerUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  getUsers,
  deleteUser,
  getUserById,
  updateUser,
  getAddressAndLocation,
  updateAddressAndLocation,
  deleteAddressAndLocation,
  addAddressAndLocation,
  forgotPassword,
} from '../controllers/userController.js';
import {
  getCustomerByPhoneNoPOS,
  createCustomerPOS,
  updateCustomerByPhoneNoPOS,
  deleteCustomerPOS,
  getFilteredCustomersPOS,
} from '../controllers/posCustomerController.js';

import { protect, admin } from '../middleware/authMiddleware.js';
import { protectPOS as posProtect, cashierOrAdmin, admin as posAdmin } from '../middleware/posAuthMiddleware.js';
import loginLimiter from '../utils/rateLimiter.js';

const router = express.Router();

// POS ROUTES
router.route('/pos/:phoneNo').get(posProtect, cashierOrAdmin, getCustomerByPhoneNoPOS);
router.route('/pos').get(posProtect, posAdmin, getFilteredCustomersPOS).post(posProtect, cashierOrAdmin, createCustomerPOS);
router.route('/pos/phone/:phoneNo')
  .put(posProtect, cashierOrAdmin, updateCustomerByPhoneNoPOS)
  .delete(posProtect, posAdmin, deleteCustomerPOS);
// END of POS ROUTES  


router.route('/').post(registerUser).get(protect, admin, getUsers);
router.post('/auth', loginLimiter,authUser);
router.post('/logout', logoutUser);
router
  .route('/profile')
  .get(protect, getUserProfile)
  .put(protect, updateUserProfile);

// Forgot Password route
router.post('/forgot-password',loginLimiter, forgotPassword);
// Address and location routes
router.route('/address')
  .get(protect, getAddressAndLocation)
  .post(protect, addAddressAndLocation)
  .put(protect, updateAddressAndLocation)
  .delete(protect, deleteAddressAndLocation);
router
  .route('/:id')
  .delete(protect, admin, deleteUser)
  .get(protect, admin, getUserById)
  .put(protect, admin, updateUser);
router
  .route('/:phoneNo')
  .get(getUserByPhoneNo);

export default router;
