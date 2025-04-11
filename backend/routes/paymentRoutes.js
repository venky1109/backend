import express from 'express';
import { initiatePaymentAtDelivery,initiatePayment, handlePaymentResponse } from '../controllers/paymentController.js';

const router = express.Router();


router.post('/initiateJuspayPaymentAtDelivery', initiatePaymentAtDelivery); 
                                                
// Route to initiate payment
router.post('/initiateJuspayPayment', initiatePayment);

// Route to handle payment response
router.post('/handleJuspayResponse', handlePaymentResponse);

export default router;
