import express from 'express';
import {
  loginPosUser,
  registerPosUser,
  getPosUsers,
  updatePosUser,
  deletePosUser,
  setPosUserBalance,
  getPosUserBalance
} from '../controllers/posUserController.js';

import { protectPOS, isAdminOrProp,cashierOrAdmin } from '../middleware/posAuthMiddleware.js';

const router = express.Router();

router.post('/login', loginPosUser);
router.post('/', protectPOS, isAdminOrProp, registerPosUser);
router.get('/', protectPOS, isAdminOrProp, getPosUsers);
router.put('/:id', protectPOS, isAdminOrProp, updatePosUser);
router.delete('/:id', protectPOS, isAdminOrProp, deletePosUser);
router.get('/balance/:id', protectPOS, cashierOrAdmin, getPosUserBalance);
router.put('/balance/:id', protectPOS, isAdminOrProp, setPosUserBalance);
// cashierOrAdmin

export default router;
