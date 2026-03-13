import express from 'express';
import {
  initiatePaymentAtDelivery,
  initiatePayment,
  completePosUpiPayment,
  handlePaymentResponse,
} from '../controllers/paymentController.js';

const router = express.Router();

router.post('/initiateJuspayPaymentAtDelivery', initiatePaymentAtDelivery);
router.post('/initiateJuspayPayment', initiatePayment);
router.post('/completePosUpiPayment', completePosUpiPayment);

// Juspay may hit as POST, and redirect flow can also be handled with GET if needed
router.post('/handleJuspayResponse', handlePaymentResponse);
router.get('/handleJuspayResponse', handlePaymentResponse);

export default router;