import asyncHandler from '../middleware/asyncHandler.js';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';

// Utility to calculate order prices
const calcPrices = (items) => {
  const itemsPrice = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const shippingPrice = 0;
  const totalPrice = itemsPrice + shippingPrice;
  return { itemsPrice, shippingPrice, totalPrice };
};

// ➕ Create POS Order
const addOrderItemsPOS = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod, user, orderId } = req.body;
// console.log(req.body)
  if (!orderItems?.length) {
    res.status(400);
    throw new Error('No order items provided');
  }

  const productIds = orderItems.map((x) => x.productId);
  if (productIds.some((id) => !id || id.includes('-'))) {
    res.status(400);
    throw new Error('Invalid productId format. Must be individual MongoDB ObjectIds.');
  }

  const itemsFromDB = await Product.find({ _id: { $in: productIds } });

const dbOrderItems = orderItems.map((item) => {
  const product = itemsFromDB.find((p) => p._id.toString() === item.productId);
  if (!product) throw new Error(`Product not found: ${item.productId}`);

  const detail = product.details.find((d) => d._id.toString() === item.brandId);
  if (!detail) throw new Error(`Brand not found: ${item.brandId}`);

  const finance = detail.financials.find((f) => f._id.toString() === item.financialId);
  if (!finance) throw new Error(`Financials not found: ${item.financialId}`);

  return {
    name: product.name, // ✅ Use product name (safe fallback)
    brand: detail.brand, // ✅ This is required in schema
    quantity: item.quantity,
    units: item.units,
    qty: item.qty,
    image: item.image,
    price: finance.dprice,
    product: product._id,
  };
});


  const { itemsPrice, shippingPrice, totalPrice } = calcPrices(dbOrderItems);
   const source = 'CASHIER';
  const order = new Order({
    orderItems: dbOrderItems,
    user,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    shippingPrice,
    totalPrice,
    orderId,
    source,
  });

  const createdOrder = await order.save();
  res.status(201).json(createdOrder);
});


// 📦 POS: Get All Orders (latest first, limited, populated)
const getOrdersPOS = asyncHandler(async (req, res) => {
  const orders = await Order.find({})
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('user', '_id name phoneNo');
//   console.log(orders);
    res.json(orders);
  
});

const getOrderPOSItemsByOrderId = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);

  if (order) {
    res.json(order.orderItems || []);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});
const getAllOrdersWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({}).sort({ createdAt: -1 }).populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    packingTimer: order.packingStartedAt ? Date.now() - new Date(order.packingStartedAt).getTime() : null,
    dispatchTimer: order.dispatchStartedAt ? Date.now() - new Date(order.dispatchStartedAt).getTime() : null,
    deliveryTimer: order.deliveryStartedAt ? Date.now() - new Date(order.deliveryStartedAt).getTime() : null,
  }));

  res.json(enriched);
});
const getOrdersToPackWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({ isPacked: false }).sort({ createdAt: -1 }).populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    packingTimer: order.packingStartedAt ? Date.now() - new Date(order.packingStartedAt).getTime() : null,
  }));

  res.json(enriched);
});
const getOrdersToDispatchWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({ isPacked: true, isDispatched: false }).sort({ createdAt: -1 }).populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    dispatchTimer: order.dispatchStartedAt ? Date.now() - new Date(order.dispatchStartedAt).getTime() : null,
  }));

  res.json(enriched);
});
const getOrdersToDeliverWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({ isDispatched: true, isDelivered: false }).sort({ createdAt: -1 }).populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    deliveryTimer: order.deliveryStartedAt ? Date.now() - new Date(order.deliveryStartedAt).getTime() : null,
  }));

  res.json(enriched);
});


// 1. Mark as Packed
const updateOrderToPackedWithTimers = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (order) {
      order.isPacked = true;
      order.packedAt = Date.now();
      await order.save();
      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. Mark as Dispatched
const updateOrdersToDispatchedWithTimers = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (order) {
      order.isDispatched = true;
      order.dispatchedAt = Date.now();
      await order.save();
      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. Mark as Delivered
const updateOrdersToDeliveredWithTimers = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (order) {
      order.isDelivered = true;
      order.deliveredAt = Date.now();
      await order.save();
      res.json(order);
    } else {
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export { addOrderItemsPOS, getOrdersPOS , getOrderPOSItemsByOrderId , getAllOrdersWithTimers,
  getOrdersToPackWithTimers,
  getOrdersToDispatchWithTimers,
  getOrdersToDeliverWithTimers,updateOrderToPackedWithTimers,updateOrdersToDeliveredWithTimers,updateOrdersToDispatchedWithTimers};
