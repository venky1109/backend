import express from 'express';
import { initiatePaymentAtDelivery, handlePaymentResponse, retryPaymentForExistingOrder, initiatePayment,
   } from '../controllers/paymentController.js';

const router = express.Router();


router.post('/initiateJuspayPaymentAtDelivery', initiatePaymentAtDelivery); 
                                                
// // Route to initiate payment
router.post('/initiateJuspayPayment', initiatePayment);

// Juspay may hit as POST, and redirect flow can also be handled with GET if needed
router.post('/handleJuspayResponse', handlePaymentResponse);
router.get('/handleJuspayResponse', handlePaymentResponse);
router.post('/retry/:orderId', retryPaymentForExistingOrder);


export default router;
