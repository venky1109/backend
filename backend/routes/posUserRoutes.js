import express from 'express';
import {
  loginPosUser,
  registerPosUser,
  getPosUsers,
  updatePosUser,
  deletePosUser
} from '../controllers/posUserController.js';

import { protectPOS, isAdminOrProp } from '../middleware/posAuthMiddleware.js';

const router = express.Router();

router.post('/login', loginPosUser);
router.post('/', protectPOS, isAdminOrProp, registerPosUser);
router.get('/', protectPOS, isAdminOrProp, getPosUsers);
router.put('/:id', protectPOS, isAdminOrProp, updatePosUser);
router.delete('/:id', protectPOS, isAdminOrProp, deletePosUser);

export default router;
