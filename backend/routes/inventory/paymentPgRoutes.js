import express from 'express';

import { PgPayment } from '../../models/inventory/paymentPgModel.js';

import {
  list,
  getById,
  create,
  update,
  remove,
} from '../../controllers/inventory/crudController.js';

import {
  protectPOS,
  paymentAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();


// 🔒 Secure routes
router.use(protectPOS);
router.use(paymentAccess);


// 💰 Payments
router.route('/')
  .get(list(PgPayment))
  .post(create(PgPayment));

router.route('/:id')
  .get(getById(PgPayment))
  .put(update(PgPayment))
  .delete(remove(PgPayment));

export default router;