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
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.route('/').post(registerUser).get(protect, admin, getUsers);
router.post('/auth', authUser);
router.post('/logout', logoutUser);
router
  .route('/profile')
  .get(protect, getUserProfile)
  .put(protect, updateUserProfile);

// Forgot Password route
router.post('/forgot-password', forgotPassword);
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
