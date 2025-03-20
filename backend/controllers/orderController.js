import asyncHandler from '../middleware/asyncHandler.js';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import { calcPrices } from '../utils/calcPrices.js';
// import { verifyPayPalPayment, checkIfNewTransaction } from '../utils/paypal.js';
// import asyncHandler from 'express-async-handler';
// import { Juspay, APIError } from 'expresscheckout-nodejs';

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
// const addOrderItems = asyncHandler(async (req, res) => {
//   const { orderItems, shippingAddress, paymentMethod,itemsPrice,shippingPrice,totalPrice } = req.body;

 

//   if (orderItems && orderItems.length === 0) {
//     res.status(400);
//     throw new Error('No order items');
//   } else {
//     // NOTE: here we must assume that the prices from our client are incorrect.
//     // We must only trust the price of the item as it exists in
//     // our DB. This prevents a user paying whatever they want by hacking our client
//     // side code - https://gist.github.com/bushblade/725780e6043eaf59415fbaf6ca7376ff

//     // get the ordered items from our database
//     const itemsFromDB = await Product.find({
//       _id: { $in: orderItems.map((x) => x.productId) },
//     });



//     // map over the order items and use the price from our items from database
//     const dbOrderItems = orderItems.map((itemFromClient) => {
//       const matchingItemFromDB = itemsFromDB.find(
//         (itemFromDB) =>( itemFromDB._id.toString() === itemFromClient.productId  )
//       );

//       const DBOrderDetails = matchingItemFromDB.details.find(
//         (itemFromDB) =>( itemFromDB._id.toString() === itemFromClient.brandId  )
//       );
//       const DBFinanceDetails = DBOrderDetails.financials.find(
//         (itemFromDB) =>( itemFromDB._id.toString() === itemFromClient.financialId  )
//       );

//       // console.log(matchingItemFromDB);
//       // const price=DBFinanceDetails.dprice *  itemFromClient.qty
//       return {
//         ...itemFromClient,
//         product: matchingItemFromDB,
//         price: DBFinanceDetails.dprice,
//         _id: undefined,
//       };
//     });
   
//     // calculate prices
//     const { itemsPrice,  shippingPrice, totalPrice } =
//       calcPrices(dbOrderItems);
//       // console.log(dbOrderItems);
//     const order = new Order({
//       orderItems: dbOrderItems,
//       user: req.user._id,
//       shippingAddress,
//       paymentMethod,
//       itemsPrice,
//       // taxPrice,
//       shippingPrice,
//       totalPrice,
//     });
     
//     const createdOrder = await order.save();

//     res.status(201).json(createdOrder);
//   }
// });
// const juspay = new Juspay({
//   merchantId: process.env.MERCHANT_ID,
//   baseUrl:
//     process.env.ENVIRONMENT === 'production'
//       ? 'https://smartgateway.hdfcbank.com'
//       : 'https://smartgatewayuat.hdfcbank.com',
//   jweAuth: {
//     keyId: process.env.KEY_UUID,
//     publicKey: process.env.PUBLIC_KEY,
//     privateKey: process.env.PRIVATE_KEY,
//   },
// });
const addOrderItems = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod,orderId } = req.body;
  console.log('Request Body:', req.body);


  if (orderItems && orderItems.length === 0) {
    res.status(400);
    throw new Error('No order items');
  } else {
    // Get the ordered items from the database
    const itemsFromDB = await Product.find({
      _id: { $in: orderItems.map((x) => x.productId) },
    });

    // Map over the order items and ensure that we use the prices from the database
    const dbOrderItems = orderItems.map((itemFromClient) => {
      const matchingItemFromDB = itemsFromDB.find(
        (itemFromDB) => itemFromDB._id.toString() === itemFromClient.productId
      );

      if (!matchingItemFromDB) {
        throw new Error(`Product not found: ${itemFromClient.productId}`);
      }

      const DBOrderDetails = matchingItemFromDB.details.find(
        (itemFromDB) => itemFromDB._id.toString() === itemFromClient.brandId
      );

      if (!DBOrderDetails) {
        throw new Error(`Brand not found: ${itemFromClient.brandId}`);
      }

      const DBFinanceDetails = DBOrderDetails.financials.find(
        (itemFromDB) => itemFromDB._id.toString() === itemFromClient.financialId
      );

      if (!DBFinanceDetails) {
        throw new Error(`Financial details not found: ${itemFromClient.financialId}`);
      }

      // Return the client item with the price from the DB
      return {
        ...itemFromClient,
        product: matchingItemFromDB,
        price: DBFinanceDetails.dprice, // Use dprice for discounted price
      };
    });

    // Calculate prices (ensure you have this function defined)
    const { itemsPrice, shippingPrice, totalPrice } = calcPrices(dbOrderItems);

    // Create and save the new order
    const order = new Order({
      orderItems: dbOrderItems,
      user: req.user._id,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      shippingPrice,
      totalPrice,
      orderId,
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  }
});


// @desc    Get logged in user orders
// @route   GET /api/orders/myorders
// @access  Private
const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id });
  res.json(orders);
});

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
const getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(
    'user',
    'name phoneNo'
  );

  if (order) {
    res.json(order);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Update order to paid
// @route   PUT /api/orders/:id/pay
// @access  Private
// const updateOrderToPaid = asyncHandler(async (req, res) => {
//   const { order_id } = req.body;

//   if (!order_id) {
//     res.status(400);
//     throw new Error('Order ID is required');
//   }

//   try {
//     // Verify payment status with Juspay
//     const statusResponse = await juspay.order.status(order_id);
//     const orderStatus = statusResponse.status;

//     if (orderStatus !== 'CHARGED') {
//       throw new Error(`Payment not verified. Status: ${orderStatus}`);
//     }

//     // Check if the transaction has been used before
//     const isNewTransaction = await Order.exists({ 'paymentResult.id': order_id });
//     if (isNewTransaction) {
//       throw new Error('Transaction has already been used');
//     }

//     // Find the order by ID in the database
//     const order = await Order.findById(req.params.id);
//     if (!order) {
//       res.status(404);
//       throw new Error('Order not found');
//     }

//     // Validate that the correct amount was paid
//     const paidCorrectAmount = order.totalPrice.toString() === statusResponse.amount.toString();
//     if (!paidCorrectAmount) {
//       throw new Error('Incorrect amount paid');
//     }

//     // Mark the order as paid and save the payment details
//     order.isPaid = true;
//     order.paidAt = Date.now();
//     order.paymentResult = {
//       id: order_id,
//       status: orderStatus,
//       update_time: statusResponse.last_updated,
//       phone_Number: statusResponse.customer_phone,
//     };

//     const updatedOrder = await order.save();

//     res.json(updatedOrder);
//   } catch (error) {
//     console.error('Update Order to Paid Error:', error.message);
//     res.status(500);
//     throw new Error(error.message || 'Internal Server Error');
//   }
// });
const updateOrderToPaid = asyncHandler(async (req, res) => {
  const { id, status, update_time } = req.body;

  if (!id) {
    res.status(400);
    throw new Error('Order ID is required');
  }

  const order = await Order.findById(req.params.id);

  if (order) {
    if (status !== 'CHARGED') {
      res.status(400);
      throw new Error('Payment not verified');
    }

    order.isPaid = true;
    order.paidAt = update_time;
    order.paymentResult = {
      id, // Juspay Order ID
      status,
      update_time,
    };

    const updatedOrder = await order.save();
    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});


// @desc    Update order to delivered
// @route   GET /api/orders/:id/deliver
// @access  Private/Admin
const updateOrderToDelivered = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    order.isDelivered = true;
    order.deliveredAt = Date.now();

    const updatedOrder = await order.save();

    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// @desc    Get all orders
// @route   GET /api/orders
// @access  Private/Admin
const getOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).populate('user', 'id name');
  res.json(orders);
});

export {
  addOrderItems,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  getOrders,
};
