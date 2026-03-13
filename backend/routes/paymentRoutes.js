import express from 'express';
import {
  initiatePaymentAtDelivery,
  initiatePayment,
  handlePaymentResponse,
  completePosUpiPayment,
} from '../controllers/paymentController.js';

const router = express.Router();

router.post('/initiateJuspayPaymentAtDelivery', initiatePaymentAtDelivery);
router.post('/initiateJuspayPayment', initiatePayment);
router.post('/completePosUpiPayment', completePosUpiPayment);
router.post('/handleJuspayResponse', handlePaymentResponse);

export default router;