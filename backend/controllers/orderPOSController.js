import asyncHandler from '../middleware/asyncHandler.js';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';
import User from '../models/userModel.js';

// Utility to calculate order prices
const calcPrices = (items) => {
  const itemsPrice = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const shippingPrice = 0;
  const totalPrice = itemsPrice + shippingPrice;
  return { itemsPrice, shippingPrice, totalPrice };
};

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

  if (!or.length) return null;

  return { $or: or };
};

// ------------------------------------
// Access filters
// ------------------------------------

// POS orders => source: CASHIER
// CASHIER => only own orders in own location
// MANAGER => all POS orders in own location
// ADMIN => all POS orders in all locations, including null
const buildPOSAccessFilter = (loggedInUser) => {
  const base = { source: 'CASHIER' };

  if (!loggedInUser) return base;

  const role = String(loggedInUser.role || '').toUpperCase();
  const username = loggedInUser.username || null;
  const location = loggedInUser.location || null;

  if (role === 'CASHIER') {
    return {
      ...base,
      posUserName: username,
      posLocation: location,
    };
  }

  if (role === 'MANAGER') {
    return {
      ...base,
      posLocation: location,
    };
  }

  if (role === 'ADMIN') {
    return base;
  }

  return base;
};

// ONLINE orders => source: ONLINE
// Example access:
// CASHIER => no online orders
// MANAGER => online orders for own location only, if mapped by city
// ADMIN => all online orders
const buildOnlineAccessFilter = (loggedInUser) => {
  const base = { source: 'ONLINE' };

  if (!loggedInUser) return base;

  const role = String(loggedInUser.role || '').toUpperCase();
  const location = loggedInUser.location || null;

  if (role === 'CASHIER') {
    return { _id: null }; // deny
  }

  if (role === 'MANAGER') {
    return {
      ...base,
      'shippingAddress.city': location,
    };
  }

  if (role === 'ADMIN') {
    return base;
  }

  return base;
};

// ------------------------------------
// POS: Create Order
// ------------------------------------
const addOrderItemsPOS = asyncHandler(async (req, res) => {
  const {
    orderItems,
    shippingAddress,
    paymentMethod,
    user,
    orderId,
    MK_order_id,
    posUserName,
    posLocation,
  } = req.body;

  if (!orderItems?.length) {
    res.status(400);
    throw new Error('No order items provided');
  }

  if (MK_order_id === undefined || MK_order_id === null) {
    res.status(400);
    throw new Error('MK_order_id is required for POS orders');
  }

  const numericMkOrderId = Number(MK_order_id);
  if (!Number.isFinite(numericMkOrderId)) {
    res.status(400);
    throw new Error('MK_order_id must be a valid number');
  }

  const existingOrder = await Order.findOne({ MK_order_id: numericMkOrderId });
  if (existingOrder) {
    return res.status(200).json(existingOrder);
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

  let resolvedPosUserName = posUserName || null;
  let resolvedPosLocation = posLocation || null;

  if (user && mongoose.Types.ObjectId.isValid(user)) {
    const posUser = await User.findById(user).select('username location');
    if (posUser) {
      resolvedPosUserName = resolvedPosUserName || posUser.username || null;
      resolvedPosLocation = resolvedPosLocation || posUser.location || null;
    }
  }

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
      MK_order_id: numericMkOrderId,
      source,
      isPaid,
      paidAt: isPaid ? Date.now() : null,
      posUserName: resolvedPosUserName,
      posLocation: resolvedPosLocation,
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

// ------------------------------------
// POS: Search / Filter Orders
// mode = latest | today | custom | phone
// ------------------------------------
const getFilteredPOSOrders = asyncHandler(async (req, res) => {
  const { mode, phone, from, to } = req.query;

  let query = buildPOSAccessFilter(req.user);
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

    const orders = await Order.find(query)
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
      posUserName: order.posUserName || '',
      posLocation: order.posLocation || '',
      source: order.source || '',
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
    posUserName: order.posUserName || '',
    posLocation: order.posLocation || '',
    source: order.source || '',
  }));

  res.json(shaped);
});

// ------------------------------------
// POS: Order Details
// ------------------------------------
const getPOSOrderDetails = asyncHandler(async (req, res) => {
  const filter = buildOrderLookup(req.params.id);

  if (!filter) {
    res.status(400);
    throw new Error('Invalid order identifier');
  }

  const accessFilter = buildPOSAccessFilter(req.user);

  const order = await Order.findOne({
    ...accessFilter,
    ...filter,
  }).populate('user', '_id name phoneNo');

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
    posUserName: order.posUserName || '',
    posLocation: order.posLocation || '',
    source: order.source || '',
    items,
  });
});

// ------------------------------------
// POS: Get Latest Orders
// ------------------------------------
const getOrdersPOS = asyncHandler(async (req, res) => {
  const query = buildPOSAccessFilter(req.user);

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('user', '_id name phoneNo');

  res.json(orders);
});

// ------------------------------------
// POS: Get Order Items by Order ID / MK ID
// ------------------------------------
const getOrderPOSItemsByOrderId = asyncHandler(async (req, res) => {
  const filter = buildOrderLookup(req.params.id);

  if (!filter) {
    res.status(400);
    throw new Error('Invalid order identifier');
  }

  const accessFilter = buildPOSAccessFilter(req.user);

  const order = await Order.findOne({
    ...accessFilter,
    ...filter,
  });

  if (order) {
    res.json(order.orderItems || []);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});

// ------------------------------------
// POS: All Orders with Timers
// ------------------------------------
const getAllOrdersWithTimers = asyncHandler(async (req, res) => {
  const query = buildPOSAccessFilter(req.user);

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map((order) => ({
    ...order.toObject(),
    packingTimer: order.packingStartedAt
      ? Date.now() - new Date(order.packingStartedAt).getTime()
      : null,
    dispatchTimer: order.dispatchStartedAt
      ? Date.now() - new Date(order.dispatchStartedAt).getTime()
      : null,
    deliveryTimer: order.deliveryStartedAt
      ? Date.now() - new Date(order.deliveryStartedAt).getTime()
      : null,
  }));

  res.json(enriched);
});

// ------------------------------------
// POS: Orders To Pack
// ------------------------------------
const getOrdersToPackWithTimers = asyncHandler(async (req, res) => {
  const query = {
    ...buildPOSAccessFilter(req.user),
    isPacked: false,
  };

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map((order) => ({
    ...order.toObject(),
    packingTimer: order.packingStartedAt
      ? Date.now() - new Date(order.packingStartedAt).getTime()
      : null,
  }));

  res.json(enriched);
});

// ------------------------------------
// POS: Orders To Dispatch
// ------------------------------------
const getOrdersToDispatchWithTimers = asyncHandler(async (req, res) => {
  const query = {
    ...buildPOSAccessFilter(req.user),
    isPacked: true,
    isDispatched: false,
  };

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map((order) => ({
    ...order.toObject(),
    dispatchTimer: order.dispatchStartedAt
      ? Date.now() - new Date(order.dispatchStartedAt).getTime()
      : null,
  }));

  res.json(enriched);
});

// ------------------------------------
// POS: Orders To Deliver
// ------------------------------------
const getOrdersToDeliverWithTimers = asyncHandler(async (req, res) => {
  const query = {
    ...buildPOSAccessFilter(req.user),
    isDispatched: true,
    isDelivered: false,
  };

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  const enriched = orders.map((order) => ({
    ...order.toObject(),
    deliveryTimer: order.deliveryStartedAt
      ? Date.now() - new Date(order.deliveryStartedAt).getTime()
      : null,
  }));

  res.json(enriched);
});

// ------------------------------------
// POS: Mark Packed
// ------------------------------------
const updateOrderToPackedWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const accessFilter = buildPOSAccessFilter(req.user);

    const order = await Order.findOne({
      ...accessFilter,
      ...filter,
    });

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

// ------------------------------------
// POS: Mark Dispatched
// ------------------------------------
const updateOrdersToDispatchedWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const accessFilter = buildPOSAccessFilter(req.user);

    const order = await Order.findOne({
      ...accessFilter,
      ...filter,
    });

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

// ------------------------------------
// POS: Mark Delivered
// ------------------------------------
const updateOrdersToDeliveredWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const accessFilter = buildPOSAccessFilter(req.user);

    const order = await Order.findOne({
      ...accessFilter,
      ...filter,
    });

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

// ------------------------------------
// POS: Mark Paid
// ------------------------------------
const updateOrdersToPaidWithTimers = async (req, res) => {
  try {
    const filter = buildOrderLookup(req.params.id);
    if (!filter) return res.status(400).json({ message: 'Invalid order identifier' });

    const accessFilter = buildPOSAccessFilter(req.user);

    const order = await Order.findOne({
      ...accessFilter,
      ...filter,
    });

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

// ------------------------------------
// ONLINE: Example list controller
// ------------------------------------
const getOnlineOrders = asyncHandler(async (req, res) => {
  const query = buildOnlineAccessFilter(req.user);

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .populate('user', '_id name phoneNo');

  res.json(orders);
});

// ------------------------------------
// ONLINE: Example details controller
// ------------------------------------
const getOnlineOrderDetails = asyncHandler(async (req, res) => {
  const filter = buildOrderLookup(req.params.id);

  if (!filter) {
    res.status(400);
    throw new Error('Invalid order identifier');
  }

  const accessFilter = buildOnlineAccessFilter(req.user);

  const order = await Order.findOne({
    ...accessFilter,
    ...filter,
  }).populate('user', '_id name phoneNo');

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  res.json(order);
});

export {
  addOrderItemsPOS,
  getOrdersPOS,
  getOrderPOSItemsByOrderId,
  getAllOrdersWithTimers,
  getOrdersToPackWithTimers,
  getOrdersToDispatchWithTimers,
  getOrdersToDeliverWithTimers,
  updateOrderToPackedWithTimers,
  updateOrdersToDeliveredWithTimers,
  updateOrdersToDispatchedWithTimers,
  updateOrdersToPaidWithTimers,
  getFilteredPOSOrders,
  getPOSOrderDetails,
  getOnlineOrders,
  getOnlineOrderDetails,
};