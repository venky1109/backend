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

import mongoose from 'mongoose';

const buildOrderLookup = (idOrMk) => {
  const trimmed = String(idOrMk).trim();

  const or = [];
  if (mongoose.Types.ObjectId.isValid(trimmed)) {
    or.push({ _id: trimmed });
  }

  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) {
    or.push({ MK_order_id: asNum });
  }

  if (!or.length) {
    return null;
  }

  return { $or: or };
};

// ➕ Create POS Order
const addOrderItemsPOS = asyncHandler(async (req, res) => {
  const {
    orderItems,
    shippingAddress,
    paymentMethod,
    user,
    orderId,
    MK_order_id,
  } = req.body;

  if (!orderItems?.length) {
    res.status(400);
    throw new Error('No order items provided');
  }
//ppp
  // if (MK_order_id === undefined || MK_order_id === null) {
  //   res.status(400);
  //   throw new Error('MK_order_id is required for POS orders');
  // }

  // const numericMkOrderId = Number(MK_order_id);
  let numericMkOrderId = null;

if (MK_order_id !== undefined && MK_order_id !== null && MK_order_id !== '') {
  numericMkOrderId = Number(MK_order_id);

  if (!Number.isFinite(numericMkOrderId)) {
    res.status(400);
    throw new Error('MK_order_id must be a valid number');
  }

  const existingOrder = await Order.findOne({ MK_order_id: numericMkOrderId });
  if (existingOrder) {
    return res.status(200).json(existingOrder);
  }
}
//ppp
  // if (!Number.isFinite(numericMkOrderId)) {
  //   res.status(400);
  //   throw new Error('MK_order_id must be a valid number');
  // }

  // const existingOrder = await Order.findOne({ MK_order_id: numericMkOrderId });
  // if (existingOrder) {
  //   return res.status(200).json(existingOrder);
  // }

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
      name: product.name,
      brand: detail.brand,
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
  const isPaid = paymentMethod?.toUpperCase() === 'CASH';

  try {
    const createdOrder = await Order.create({
      orderItems: dbOrderItems,
      user,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      shippingPrice,
      totalPrice,
      orderId,
      // MK_order_id: numericMkOrderId,//ppp
      MK_order_id: numericMkOrderId,
      source,
      isPaid,
      paidAt: isPaid ? Date.now() : null,
    });

    return res.status(201).json(createdOrder);
  } catch (err) {
    if (err?.code === 11000) {
      const duplicateOrder = await Order.findOne({ MK_order_id: numericMkOrderId });
      if (duplicateOrder) {
        return res.status(200).json(duplicateOrder);
      }
    }
    throw err;
  }
});
// Get POS orders with filters:
// mode = latest | today | custom | phone
const getFilteredPOSOrders = asyncHandler(async (req, res) => {
  const { mode, phone, from, to } = req.query;

  let query = { source: 'CASHIER' };
  const now = new Date();

  if (mode === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    query.createdAt = { $gte: start, $lte: end };
  }

  if (mode === 'custom') {
    if (!from || !to) {
      res.status(400);
      throw new Error('from and to dates are required for custom filter');
    }

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);

    const end = new Date(to);
    end.setHours(23, 59, 59, 999);

    query.createdAt = { $gte: start, $lte: end };
  }

  if (mode === 'phone') {
    if (!phone) {
      res.status(400);
      throw new Error('phone number is required');
    }

    const orders = await Order.find({ source: 'CASHIER' })
      .sort({ createdAt: -1 })
      .populate('user', '_id name phoneNo');

    const filtered = orders.filter(
      (order) => String(order?.user?.phoneNo || '') === String(phone)
    );

    const shaped = filtered.map((order) => ({
      _id: order._id,
      MK_order_id: order.MK_order_id,
      createdAt: order.createdAt,
      orderId: order.orderId,
      phoneNo: order?.user?.phoneNo || '',
      totalPrice: order.totalPrice || 0,
    }));

    return res.json(shaped);
  }

  let limit = 50000;
  if (mode === 'latest' || !mode) {
    limit = 10;
  }

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('user', '_id name phoneNo');

  const shaped = orders.map((order) => ({
    _id: order._id,
    MK_order_id: order.MK_order_id,
    createdAt: order.createdAt,
    orderId: order.orderId,
    phoneNo: order?.user?.phoneNo || '',
    totalPrice: order.totalPrice || 0,
  }));

  res.json(shaped);
});

// Get one order details with products for popup/details table
const getPOSOrderDetails = asyncHandler(async (req, res) => {
  const filter = buildOrderLookup(req.params.id);

  if (!filter) {
    res.status(400);
    throw new Error('Invalid order identifier');
  }

  const order = await Order.findOne(filter).populate('user', '_id name phoneNo');

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const items = (order.orderItems || []).map((item, index) => ({
    sNo: index + 1,
    item: item.name || '',
    weight: `${item.quantity || ''} ${item.units || ''}`.trim(),
    qty: item.qty || 0,
    pricePerQty: item.price || 0,
    amount: (item.qty || 0) * (item.price || 0),
  }));

  res.json({
    _id: order._id,
    MK_order_id: order.MK_order_id,
    orderId: order.orderId,
    phoneNo: order?.user?.phoneNo || '',
    totalPrice: order.totalPrice || 0,
    items,
  });
});
// 📦 POS: Get All Orders (latest first, limited, populated)
const getOrdersPOS = asyncHandler(async (req, res) => {
  const orders = await Order.find({ source: 'CASHIER' })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('user', '_id name phoneNo');

  res.json(orders);
});

const getOrderPOSItemsByOrderId = asyncHandler(async (req, res) => {
  const filter = buildOrderLookup(req.params.id);

  if (!filter) {
    res.status(400);
    throw new Error('Invalid order identifier');
  }

  const order = await Order.findOne(filter);

  if (order) {
    res.json(order.orderItems || []);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});
const getAllOrdersWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({ source: 'CASHIER' })
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    packingTimer: order.packingStartedAt ? Date.now() - new Date(order.packingStartedAt).getTime() : null,
    dispatchTimer: order.dispatchStartedAt ? Date.now() - new Date(order.dispatchStartedAt).getTime() : null,
    deliveryTimer: order.deliveryStartedAt ? Date.now() - new Date(order.deliveryStartedAt).getTime() : null,
  }));

  res.json(enriched);
});

const getOrdersToPackWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({ source: 'CASHIER', isPacked: false })
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    packingTimer: order.packingStartedAt ? Date.now() - new Date(order.packingStartedAt).getTime() : null,
  }));

  res.json(enriched);
});

const getOrdersToDispatchWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({ source: 'CASHIER', isPacked: true, isDispatched: false })
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    dispatchTimer: order.dispatchStartedAt ? Date.now() - new Date(order.dispatchStartedAt).getTime() : null,
  }));

  res.json(enriched);
});

const getOrdersToDeliverWithTimers = asyncHandler(async (req, res) => {
  const orders = await Order.find({ source: 'CASHIER', isDispatched: true, isDelivered: false })
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map(order => ({
    ...order.toObject(),
    deliveryTimer: order.deliveryStartedAt ? Date.now() - new Date(order.deliveryStartedAt).getTime() : null,
  }));

  res.json(enriched);
});


const updateOrderToPackedWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const order = await Order.findOne(filter);
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

const updateOrdersToDispatchedWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const order = await Order.findOne(filter);
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

const updateOrdersToDeliveredWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const order = await Order.findOne(filter);
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

const updateOrdersToPaidWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const order = await Order.findOne(filter);
    if (order) {
      order.isPaid = true;
      order.paidAt = Date.now();
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
  getOrdersToDeliverWithTimers,updateOrderToPackedWithTimers,updateOrdersToDeliveredWithTimers,updateOrdersToDispatchedWithTimers,updateOrdersToPaidWithTimers,getFilteredPOSOrders,getPOSOrderDetails};
