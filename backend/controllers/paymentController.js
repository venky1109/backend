import Product from '../models/productModel.js';
import Order from '../models/orderModel.js';
import { Juspay, APIError } from 'expresscheckout-nodejs';
import { makeError, makeJuspayResponse } from '../utils/helpers.js';
import dotenv from 'dotenv';

dotenv.config();

const publicKey = process.env.PUBLIC_KEY;
const privateKey = process.env.PRIVATE_KEY;

// const baseUrl = process.env.ENVIRONMENT === 'production'
//   ? 'https://smartgateway.hdfcbank.com'
//   : 'https://smartgatewayuat.hdfcbank.com';

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

const getPosFrontendBaseUrl = () => {
  const raw = process.env.POS_FRONTEND_URL || 'https://pos-manakirana.firebaseapp.com/pos';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

const recalculateCartAmount = async (cartItems = []) => {
  if (!cartItems || !cartItems.length) {
    throw new Error('Cart items are required');
  }

  const productIds = cartItems.map((item) => item.productId);
  const dbProducts = await Product.find({ _id: { $in: productIds } });

  const financialIds = cartItems.map((item) => item.financialId);

  const matchedProducts = await Product.find({
    'details.financials._id': { $in: financialIds },
  });

  let matchCount = 0;

  financialIds.forEach((fid) => {
    matchedProducts.forEach((product) => {
      product.details.forEach((detail) => {
        if (detail.financials) {
          detail.financials.forEach((fin) => {
            if (String(fin._id) === String(fid)) {
              matchCount++;
            }
          });
        }
      });
    });
  });

  if (!dbProducts || matchCount !== cartItems.length) {
    throw new Error('Invalid cart items. Please verify your cart.');
  }

  let recalculatedAmount = 0;

  cartItems.forEach((cartItem) => {
    const dbProduct = dbProducts.find(
      (product) => product._id.toString() === String(cartItem.productId)
    );

    if (!dbProduct) {
      throw new Error(`Product not found for ID: ${cartItem.productId}`);
    }

    const dbDetail = dbProduct.details.find(
      (detail) => detail._id.toString() === String(cartItem.brandId)
    );

    if (!dbDetail) {
      throw new Error(`Brand details not found for ID: ${cartItem.brandId}`);
    }

    const dbFinancial = dbDetail.financials.find(
      (financial) => financial._id.toString() === String(cartItem.financialId)
    );

    if (!dbFinancial) {
      throw new Error(`Financial details not found for ID: ${cartItem.financialId}`);
    }

    recalculatedAmount += Number(dbFinancial.dprice) * Number(cartItem.qty);
  });

  return recalculatedAmount;
};

// Delivery payment
export const initiatePaymentAtDelivery = async (req, res) => {
  const { amount, customerId, order_id } = req.body;

  if (!amount || !customerId || !order_id) {
    return res.status(400).json({
      success: false,
      message: 'Amount, Customer ID, and order_id are required',
    });
  }

  try {
    const order = await Order.findById(order_id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found for provided ID',
      });
    }

    const orderAmount = Number(order.totalPrice);
    const dbAmount = orderAmount.toFixed(2);
    const clientAmount = parseFloat(amount).toFixed(2);

    if (dbAmount !== clientAmount) {
      console.error(`Amount mismatch. DB: ${dbAmount}, Client: ${clientAmount}`);
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch detected. Possible tampering.',
      });
    }

    const returnUrl = `${req.protocol}://${req.get('host')}/api/payments/handleJuspayResponse`;

    const sessionResponse = await juspay.orderSession.create({
      order_id,
      amount: orderAmount.toFixed(2),
      payment_page_client_id: process.env.PAYMENT_PAGE_CLIENT_ID,
      customer_id: customerId,
      action: 'paymentPage',
      return_url: returnUrl,
      currency: 'INR',
    });

    return res.status(200).json(makeJuspayResponse(sessionResponse));
  } catch (error) {
    console.error('Error initiating delivery payment:', error.message || error);

    if (error instanceof APIError) {
      return res.status(400).json(makeError(error.message));
    }

    return res.status(500).json(makeError('Internal Server Error. Please try again.'));
  }
};

// POS / general payment initiation
export const initiatePayment = async (req, res) => {
  const { amount, customerId, cartItems, order_id } = req.body;

  if (!amount || !customerId || !cartItems || !cartItems.length || !order_id) {
    return res.status(400).json({
      success: false,
      message: 'Amount, Customer ID, Cart Items and order_id are required',
    });
  }

  try {
    const recalculatedAmount = await recalculateCartAmount(cartItems);

    if (recalculatedAmount.toFixed(2) !== parseFloat(amount).toFixed(2)) {
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch detected. Payment initiation aborted.',
      });
    }

    // IMPORTANT:
    // return_url must go to backend, not Firebase frontend
    const returnUrl = `${req.protocol}://${req.get('host')}/api/payments/handleJuspayResponse`;

    const sessionResponse = await juspay.orderSession.create({
      order_id,
      amount: recalculatedAmount.toFixed(2),
      payment_page_client_id: process.env.PAYMENT_PAGE_CLIENT_ID,
      customer_id: customerId,
      action: 'paymentPage',
      return_url: returnUrl,
      currency: 'INR',
    });

    return res.status(200).json(makeJuspayResponse(sessionResponse));
  } catch (error) {
    console.error('Error initiating payment:', error.message || error);

    if (error instanceof APIError) {
      return res.status(400).json(makeError(error.message));
    }

    return res
      .status(500)
      .json(makeError(error.message || 'Internal Server Error. Please try again.'));
  }
};

// Optional manual verification API from frontend
export const completePosUpiPayment = async (req, res) => {
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: 'orderId is required',
    });
  }

  try {
    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    const statusResponse = await juspay.order.status(orderId);
    const orderStatus = statusResponse.status;

    if (
      parseFloat(order.totalPrice).toFixed(2) !==
      parseFloat(statusResponse.amount).toFixed(2)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Amount mismatch detected from payment gateway',
      });
    }

    if (orderStatus !== 'CHARGED') {
      return res.status(200).json({
        success: false,
        status: orderStatus,
        message: 'Payment failed or not completed',
      });
    }

    if (!order.isPaid) {
      order.isPaid = true;
      order.paidAt = Date.now();
      order.paymentResult = {
        id: statusResponse.order_id,
        status: statusResponse.status,
        update_time: statusResponse.last_updated,
        phone_number: statusResponse.customer_phone || '',
      };
      await order.save();
    }

    return res.status(200).json({
      success: true,
      status: orderStatus,
      message: 'Payment completed successfully',
      paymentResult: order.paymentResult,
    });
  } catch (error) {
    console.error('Error completing POS UPI payment:', error.message || error);

    if (error instanceof APIError) {
      return res.status(400).json(makeError(error.message));
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

// Return URL handler from Juspay
export const handlePaymentResponse = async (req, res) => {
  const orderId =
    req.body?.order_id ||
    req.body?.orderId ||
    req.query?.order_id ||
    req.query?.orderId;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: 'Order ID is required',
    });
  }

  try {
    const statusResponse = await juspay.order.status(orderId);
    const orderStatus = statusResponse.status;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found',
      });
    }

    if (
      parseFloat(order.totalPrice).toFixed(2) !==
      parseFloat(statusResponse.amount).toFixed(2)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Amount tampering detected. Payment rejected.',
      });
    }

    const posBase = getPosFrontendBaseUrl();

    let redirectUrl =
      order?.source !== 'ONLINE'
        ? `${posBase}/payment-status?orderId=${orderId}&status=failed`
        : `https://www.manakirana.com/payment/failure?orderId=${orderId}`;

    if (orderStatus === 'CHARGED') {
      order.isPaid = true;
      order.paidAt = Date.now();
      order.paymentResult = {
        id: statusResponse.order_id,
        status: orderStatus,
        update_time: statusResponse.last_updated,
        phone_number: statusResponse.customer_phone || '',
      };

      await order.save();

      redirectUrl =
        order?.source !== 'ONLINE'
          ? `${posBase}/payment-status?orderId=${orderId}&status=success`
          : `https://www.manakirana.com/payment/success?orderId=${orderId}`;
    }

    return res.redirect(302, redirectUrl);
  } catch (error) {
    console.error('Error handling payment response:', error.message || error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};