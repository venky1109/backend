import fs from 'fs';
import { Juspay, APIError } from 'expresscheckout-nodejs';
import { makeError, makeJuspayResponse } from '../utils/helpers.js';
import dotenv from 'dotenv';

dotenv.config();

// // Read keys from .env
// const publicKey = fs.readFileSync(process.env.PUBLIC_KEY_PATH, 'utf8');
// const privateKey = fs.readFileSync(process.env.PRIVATE_KEY_PATH, 'utf8');
const publicKey = process.env.PUBLIC_KEY;
const privateKey = process.env.PRIVATE_KEY;

// Initialize Juspay
// const baseUrl = process.env.ENVIRONMENT === 'production'
//     ? 'https://smartgateway.hdfcbank.com'
//     : 'https://smartgatewayuat.hdfcbank.com';

const baseUrl = 'https://smartgatewayuat.hdfcbank.com';

const juspay = new Juspay({
    merchantId: process.env.MERCHANT_ID,
    baseUrl,
    jweAuth: {
        keyId: process.env.KEY_UUID,
        publicKey,
        privateKey,
    },
});

// Controller: Initiate Payment
export const initiatePayment = async (req, res) => {
    // console.log('Request received at initiatePayment endpoint');
    // console.log('Request body:', req.body);
    
    const { amount, customerId } = req.body;
    if (!amount || !customerId) {
        return res.status(400).json({
            success: false,
            message: 'Amount and Customer ID are required',
        });
    }
    const orderId = `${Date.now()}_${customerId}`;
    

    // Create return URL
    // const returnUrl = `${req.protocol}://${req.hostname}:${process.env.PORT || 5000}/api/payments/handleJuspayResponse`;
    const returnUrl = `${req.protocol}://${req.hostname}}/api/payments/handleJuspayResponse`;

    try {
        const sessionResponse = await juspay.orderSession.create({
            order_id: req.body.order_id,
            amount,
            payment_page_client_id: process.env.PAYMENT_PAGE_CLIENT_ID,
            customer_id: req.body.customerId ,
            action: 'paymentPage',
            return_url: returnUrl,
            currency: 'INR',
        });

        res.status(200).json(makeJuspayResponse(sessionResponse));

    } catch (error) {
        if (error instanceof APIError) {
            return res.status(400).json(makeError(error.message));
        }
        res.status(500).json(makeError());
    }
};

// Controller: Handle Payment Response
export const handlePaymentResponse = async (req, res) => {
    const orderId = req.body.order_id || req.body.orderId;

    if (!orderId) {
        return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    try {
        const statusResponse = await juspay.order.status(orderId);
        const orderStatus = statusResponse.status;

        let redirectUrl = `${process.env.FRONTEND_URL}/payment/failure`;
        if (orderStatus === 'CHARGED') {
            redirectUrl = `${process.env.FRONTEND_URL}/payment/success?orderId=${orderId}`;
        }

        // Redirect to the frontend based on payment status
        return res.redirect(redirectUrl);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal server error', error });
    }
};


