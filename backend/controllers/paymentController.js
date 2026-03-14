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


// console.log('Juspay config check', {
//   environment: process.env.ENVIRONMENT,
//   merchantId: process.env.MERCHANT_ID,
//   keyUuid: process.env.KEY_UUID,
//   paymentPageClientId: process.env.PAYMENT_PAGE_CLIENT_ID,
//   hasPublicKey: Boolean(publicKey),
//   hasPrivateKey: Boolean(privateKey),
//   baseUrl,
// });

const juspay = new Juspay({
    merchantId: process.env.MERCHANT_ID,
    baseUrl,
    jweAuth: {
        keyId: process.env.KEY_UUID,
        publicKey,
        privateKey,
    },
});




export const initiatePaymentAtDelivery = async (req, res) => {
//    console.log('✅ initiatePaymentAtDelivery called', {
//   amount: req.body.amount,
//   customerId: req.body.customerId,
//   order_id: req.body.order_id,
// });

    const { amount, customerId ,order_id } = req.body;

    if (!amount || !customerId ) {
        return res.status(400).json({
            success: false,
            message: 'Amount, Customer ID, and Cart Items are required',
        });
    }

    try {
 
           // Step 1: Fetch order from DB using order_id
    const order = await Order.findById(order_id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found for provided ID',
      });
    }

    const orderAmount = order.totalPrice;

    const dbAmount = parseFloat(order.totalPrice).toFixed(2);
    const clientAmount = parseFloat(amount).toFixed(2);

    //  Amount Tampering Check
    if (dbAmount !== clientAmount) {
      console.error(`Amount mismatch. DB: ${dbAmount}, Client: ${clientAmount}`);
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch detected. Possible tampering.',
      });
    }
 // Generate return URL
         const returnUrl = `${req.protocol}://${req.get('host')}/api/payments/handleJuspayResponse`;

        // Generate return URL
       
    // console.log('----- Juspay Session Request -----');

    const sessionPayload = {
        order_id: order_id,
        amount: orderAmount.toFixed(2),
        payment_page_client_id: process.env.PAYMENT_PAGE_CLIENT_ID,
        customer_id: customerId,
        action: 'paymentPage',
        return_url: returnUrl,
        currency: 'INR',
    };

    // console.log('Payload:', sessionPayload);

    const sessionResponse = await juspay.orderSession.create(sessionPayload);

    // console.log('----- Juspay Session Response -----');
    // console.log(JSON.stringify(sessionResponse, null, 2));

        res.status(200).json(makeJuspayResponse(sessionResponse));
    } catch (error) {
        console.error('Error initiating payment:', error.message);

        if (error instanceof APIError) {
            return res.status(400).json(makeError(error.message));
        }

        res.status(500).json(makeError('Internal Server Error. Please try again.'));
    }
};

// Controller: Initiate Payment
// export const initiatePayment = async (req, res) => {
//     // console.log('Request body:', req.body);

//     const { amount, customerId, cartItems,order_id } = req.body;

//     if (!amount || !customerId || !cartItems || !cartItems.length) {
//         return res.status(400).json({
//             success: false,
//             message: 'Amount, Customer ID, and Cart Items are required',
//         });
//     }

//     try {
//         // Fetch products from the database based on cart item product IDs
//         const productIds = cartItems.map((item) => item.productId);
//         const dbProducts = await Product.find({ _id: { $in: productIds } });

//         const financialIds = cartItems.map((item) => item.financialId);


// const matchedProducts = await Product.find({
//   'details.financials._id': { $in: financialIds }
// });

// let matchCount = 0;

// // Count how many individual `financialId` entries actually matched
// financialIds.forEach(fid => {
//   matchedProducts.forEach(product => {
//     product.details.forEach(detail => {
//       if (detail.financials) {
//         detail.financials.forEach(fin => {
//           if (String(fin._id) === String(fid)) {
//             matchCount++;
//           }
//         });
//       }
//     });
//   });
// });

// // console.log("Matched financial count:", matchCount);

//         // console.log(financialIds)
//         // console.log(matchedProducts)
//         // console.log(financialIds.length,matchCount)
//         if (!dbProducts || matchCount !== cartItems.length) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Invalid cart items. Please verify your cart.',
//             });
//         }

//         // Recalculate the total amount on the backend
//         let recalculatedAmount = 0;
//         cartItems.forEach((cartItem) => {
//             const dbProduct = dbProducts.find(
//                 (product) => product._id.toString() === cartItem.productId
//             );

//             if (dbProduct) {
//                 const dbDetail = dbProduct.details.find(
//                     (detail) => detail._id.toString() === cartItem.brandId
//                 );

//                 if (dbDetail) {
//                     const dbFinancial = dbDetail.financials.find(
//                         (financial) => financial._id.toString() === cartItem.financialId
//                     );

//                     if (dbFinancial) {
//                         recalculatedAmount += dbFinancial.dprice * cartItem.qty;
//                     } else {
//                         throw new Error(`Financial details not found for ID: ${cartItem.financialId}`);
//                     }
//                 } else {
//                     throw new Error(`Brand details not found for ID: ${cartItem.brandId}`);
//                 }
//             } else {
//                 throw new Error(`Product not found for ID: ${cartItem.productId}`);
//             }
//         });
//         // console.log('recalculatedAmount',recalculatedAmount)
//         // console.log('amount'+amount)
//         // const orderId = `${Date.now()}_${customerId}`;
//           // Validate that recalculated amount matches the provided amount
//     if (recalculatedAmount.toFixed(2) !== parseFloat(amount).toFixed(2)) {
//         console.error(`Amount mismatch detected. Recalculated: ${recalculatedAmount}, Provided: ${amount}`);
//         return res.status(400).json({
//             success: false,
//             message: 'Amount mismatch detected. Payment initiation aborted.',
//         });
//     }

//         // Generate return URL
//         const returnUrl = `${req.protocol}://${req.get('host')}/api/payments/handleJuspayResponse`;
// console.log('----- Juspay Session Request -----');

//     const sessionPayload = {
//         order_id: order_id,
//         amount: recalculatedAmount.toFixed(2),
//         payment_page_client_id: process.env.PAYMENT_PAGE_CLIENT_ID,
//         customer_id: customerId,
//         action: 'paymentPage',
//         return_url: returnUrl,
//         currency: 'INR',
//     };

//     console.log('Payload:', sessionPayload);

//     const sessionResponse = await juspay.orderSession.create(sessionPayload);

//     console.log('----- Juspay Session Response -----');
//     console.log(JSON.stringify(sessionResponse, null, 2));

//     res.status(200).json(makeJuspayResponse(sessionResponse));
//     } catch (error) {
//         console.error('Error initiating payment:', error.message);

//         if (error instanceof APIError) {
//             return res.status(400).json(makeError(error.message));
//         }

//         res.status(500).json(makeError('Internal Server Error. Please try again.'));
//     }
// };

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
    return res.status(400).json({ success: false, message: 'Order ID is required' });
  }

  try {
    const statusResponse = await juspay.order.status(orderId);
    const orderStatus = statusResponse.status;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (Number(order.totalPrice).toFixed(2) !== Number(statusResponse.amount).toFixed(2)) {
      return res.status(400).json({
        success: false,
        message: 'Amount tampering detected. Payment rejected.',
      });
    }

    const posSuccess = `https://pos-manakirana.firebaseapp.com/payment/success?orderId=${orderId}`;
    const posFailure = `https://pos-manakirana.firebaseapp.com/payment/failure?orderId=${orderId}`;
    const webSuccess = `https://www.manakirana.com/payment/success?orderId=${orderId}`;
    const webFailure = `https://www.manakirana.com/payment/failure`;

    let redirectUrl = order?.source === 'ONLINE' ? webFailure : posFailure;

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

      redirectUrl = order?.source === 'ONLINE' ? webSuccess : posSuccess;
    }

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error handling payment response:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error', error });
  }
};

