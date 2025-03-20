import fs from 'fs';
import Product from '../models/productModel.js'; 
import Order from '../models/orderModel.js';
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

const baseUrl = 'https://smartgateway.hdfcbank.com';

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
    console.log('Request body:', req.body);

    const { amount, customerId, cartItems,order_id } = req.body;

    if (!amount || !customerId || !cartItems || !cartItems.length) {
        return res.status(400).json({
            success: false,
            message: 'Amount, Customer ID, and Cart Items are required',
        });
    }

    try {
        // Fetch products from the database based on cart item product IDs
        const productIds = cartItems.map((item) => item.productId);
        const dbProducts = await Product.find({ _id: { $in: productIds } });

        if (!dbProducts || dbProducts.length !== cartItems.length) {
            return res.status(400).json({
                success: false,
                message: 'Invalid cart items. Please verify your cart.',
            });
        }

        // Recalculate the total amount on the backend
        let recalculatedAmount = 0;
        cartItems.forEach((cartItem) => {
            const dbProduct = dbProducts.find(
                (product) => product._id.toString() === cartItem.productId
            );

            if (dbProduct) {
                const dbDetail = dbProduct.details.find(
                    (detail) => detail._id.toString() === cartItem.brandId
                );

                if (dbDetail) {
                    const dbFinancial = dbDetail.financials.find(
                        (financial) => financial._id.toString() === cartItem.financialId
                    );

                    if (dbFinancial) {
                        recalculatedAmount += dbFinancial.dprice * cartItem.qty;
                    } else {
                        throw new Error(`Financial details not found for ID: ${cartItem.financialId}`);
                    }
                } else {
                    throw new Error(`Brand details not found for ID: ${cartItem.brandId}`);
                }
            } else {
                throw new Error(`Product not found for ID: ${cartItem.productId}`);
            }
        });
        // console.log('recalculatedAmount',recalculatedAmount)
        // console.log('amount'+amount)
        // const orderId = `${Date.now()}_${customerId}`;
          // Validate that recalculated amount matches the provided amount
    if (recalculatedAmount.toFixed(2) !== parseFloat(amount).toFixed(2)) {
        console.error(`Amount mismatch detected. Recalculated: ${recalculatedAmount}, Provided: ${amount}`);
        return res.status(400).json({
            success: false,
            message: 'Amount mismatch detected. Payment initiation aborted.',
        });
    }

        // Generate return URL
        const returnUrl = `${req.protocol}://${req.get('host')}/api/payments/handleJuspayResponse`;

        // Create Juspay order session
        const sessionResponse = await juspay.orderSession.create({
            order_id: order_id,
            amount: recalculatedAmount.toFixed(2),
            payment_page_client_id: process.env.PAYMENT_PAGE_CLIENT_ID,
            customer_id: customerId,
            action: 'paymentPage',
            return_url: returnUrl,
            currency: 'INR',
        });

        console.log('Backend returnUrl:', returnUrl);


        // Send response to the frontend
        res.status(200).json(makeJuspayResponse(sessionResponse));
    } catch (error) {
        console.error('Error initiating payment:', error.message);

        if (error instanceof APIError) {
            return res.status(400).json(makeError(error.message));
        }

        res.status(500).json(makeError('Internal Server Error. Please try again.'));
    }
};

// Controller: Handle Payment Response
// export const handlePaymentResponse = async (req, res) => {
//     const orderId = req.body.order_id || req.body.orderId;

//     if (!orderId) {
//         return res.status(400).json({ success: false, message: 'Order ID is required' });
//     }

//     try {
//         const statusResponse = await juspay.order.status(orderId);
//         const orderStatus = statusResponse.status;
//         console.log('JusPAY Response API:', JSON.stringify(statusResponse, null, 2));


//         let redirectUrl = `${process.env.FRONTEND_URL}/payment/failure`;
//         if (orderStatus === 'CHARGED') {
//             redirectUrl = `${process.env.FRONTEND_URL}/payment/success?orderId=${orderId}`;
//         }

//         // Redirect to the frontend based on payment status
//         return res.redirect(redirectUrl);
//     } catch (error) {
//         return res.status(500).json({ success: false, message: 'Internal server error', error });
//     }
// };

export const handlePaymentResponse = async (req, res) => {
    const orderId = req.body.order_id || req.body.orderId;

    if (!orderId) {
        console.error('Order ID is missing in the request.');
        return res.status(400).json({ success: false, message: 'Order ID is required' });
    }

    try {
        // Verify payment status with Juspay
        const statusResponse = await juspay.order.status(orderId);
        const orderStatus = statusResponse.status;

        console.log('JusPAY Response API:', JSON.stringify(statusResponse, null, 2));

        // Fetch the corresponding order from the database
        // const order = await Order.findOne({ orderId });
        const order = await Order.findById(orderId); 

        if (!order) {
            console.error(`Order with ID ${orderId} not found in the database.`);
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        // Validate the amount against the database
        if (order.totalPrice.toString() !== statusResponse.amount.toString()) {
            console.error(
                `Amount mismatch for Order ID ${orderId}. Expected: ${order.totalPrice}, Received: ${statusResponse.amount}`
            );
            return res.status(400).json({ success: false, message: 'Amount tampering detected. Payment rejected.' });
        }

        let redirectUrl = `${process.env.FRONTEND_URL}/payment/failure`;

        // Update the order status if the payment is successful
        if (orderStatus === 'CHARGED') {
            order.isPaid = true;
            order.paidAt = Date.now();
            order.paymentResult = {
                id: statusResponse.order_id,
                status: orderStatus,
                update_time: statusResponse.last_updated,
                phone_Number: statusResponse.customer_phone,
            };

            await order.save();

            // console.log(`Order ID ${orderId} marked as paid successfully.`);
            redirectUrl = `${process.env.FRONTEND_URL}/payment/success?orderId=${orderId}`;
        } else {
            console.error(`Payment for Order ID ${orderId} is not successful. Status: ${orderStatus}`);
        }

        // Redirect to the frontend based on payment status
        console.log("redirectUrl"+redirectUrl)
        return res.redirect(redirectUrl);
    } catch (error) {
        console.error('Error handling payment response:', error.message || error);
        return res.status(500).json({ success: false, message: 'Internal server error', error });
    }
};


