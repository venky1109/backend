import asyncHandler from '../middleware/asyncHandler.js';
import mongoose from 'mongoose';
import Order from '../models/orderModel.js';
import Product from '../models/productModel.js';

const MAX_POS_ORDER_DISCOUNT_PERCENTAGE = 1.5;

const hasPOSOrderDiscountRequest = (req) =>
  req.body.discountPercentage !== undefined ||
  req.body.orderDiscountPercentage !== undefined ||
  req.body.orderDiscount !== undefined ||
  req.body.discount !== undefined;

// Utility to calculate order prices
const roundOrderDiscount = (itemsPrice, discountPercentage) => {
  const safeItemsPrice = Math.floor(Number(itemsPrice || 0));
  const safeDiscountPercentage = Math.min(
    Math.max(Number(discountPercentage || 0), 0),
    MAX_POS_ORDER_DISCOUNT_PERCENTAGE
  );

  const discountAmount = Math.floor(
    safeItemsPrice * (safeDiscountPercentage / 100)
  );

  return {
    itemsPrice: safeItemsPrice,
    discountPercentage: safeDiscountPercentage,
    discountAmount,
    totalPrice: safeItemsPrice - discountAmount,
  };
};

const calcPrices = (items, discountPercentage = 0) => {
  const rawItemsPrice = items.reduce((sum, item) => sum + item.qty * item.price, 0);
  const shippingPrice = 0;
  const discount = roundOrderDiscount(rawItemsPrice, discountPercentage);

  return {
    ...discount,
    shippingPrice,
  };
};

const resolvePOSOrderDiscountPercentage = (req, res, fallbackDiscountPercentage = 0) => {
  const hasRequestedDiscount = hasPOSOrderDiscountRequest(req);

  const requestedDiscount = Number(
    hasRequestedDiscount
      ? req.body.discountPercentage ??
          req.body.orderDiscountPercentage ??
          req.body.orderDiscount ??
          req.body.discount
      : fallbackDiscountPercentage
  );

  if (!Number.isFinite(requestedDiscount) || requestedDiscount < 0) {
    res.status(400);
    throw new Error('Discount percentage must be a valid positive number');
  }

  if (requestedDiscount === 0 || !hasRequestedDiscount) return Number(requestedDiscount.toFixed(2));

  const role = String(req.user?.role || '').trim().toUpperCase();
  if (!['SUPERVISOR', 'ADMIN', 'DIRECTOR'].includes(role)) {
    res.status(403);
    throw new Error('Only Supervisor or Admin can apply order discount');
  }

  return Math.min(Number(requestedDiscount.toFixed(2)), MAX_POS_ORDER_DISCOUNT_PERCENTAGE);
};

const resolveOrderStepStatus = (body, ...keys) => {
  for (const key of keys) {
    if (body[key] === undefined || body[key] === null) continue;
    if (typeof body[key] === 'boolean') return body[key];
    if (typeof body[key] === 'string') {
      const value = body[key].trim().toLowerCase();
      if (['true', 'yes', '1'].includes(value)) return true;
      if (['false', 'no', '0'].includes(value)) return false;
    }
    return Boolean(body[key]);
  }

  return false;
};

const formatRemarkDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);

const createRemark = (req, message, action = 'ORDER_UPDATED') => ({
  message,
  action,
  createdBy: req.user?._id || null,
  createdByName: req.user?.username || req.user?.name || null,
  createdAt: new Date(),
});

const itemKey = (item) =>
  [
    String(item?._id || ''),
    String(item?.productId || item?.product || ''),
    String(item?.brandId || ''),
    String(item?.financialId || ''),
  ]
    .filter(Boolean)
    .join(':');

const buildDefaultItemEditRemark = (previousItems, nextItems) => {
  const previousKeys = new Set(previousItems.map(itemKey));
  const nextKeys = new Set(nextItems.map(itemKey));
  const now = formatRemarkDate();

  const added = nextItems.filter((item) => !previousKeys.has(itemKey(item)));
  const removed = previousItems.filter((item) => !nextKeys.has(itemKey(item)));
  const shared = nextItems.filter((item) => previousKeys.has(itemKey(item)));

  const messages = [];
  if (added.length) {
    messages.push(`Added items (${added.map((item) => item.name).join(', ')}) on ${now}`);
  }
  if (removed.length) {
    messages.push(`Removed items (${removed.map((item) => item.name).join(', ')}) on ${now}`);
  }
  if (shared.length && !added.length && !removed.length) {
    messages.push(`Updated items on ${now}`);
  }

  return messages.join('. ') || `Updated order items on ${now}`;
};

const normalizeOrderItemsFromDB = async (orderItems) => {
  const productIds = orderItems.map((x) => x.productId || x.product).filter(Boolean);
  const itemsFromDB = await Product.find({ _id: { $in: productIds } });

  return orderItems.map((item) => {
    const productId = item.productId || item.product;
    const product = itemsFromDB.find((p) => p._id.toString() === String(productId));
    if (!product) throw new Error(`Product not found: ${productId}`);

    const brandId = item.brandId;
    const detail = product.details.find((d) => d._id.toString() === String(brandId));
    if (!detail) throw new Error(`Brand not found: ${brandId}`);

    const financialId = item.financialId;
    const finance = detail.financials.find((f) => f._id.toString() === String(financialId));
    if (!finance) throw new Error(`Financials not found: ${financialId}`);

    return {
      ...(item._id ? { _id: item._id } : {}),
      name: product.name,
      brand: detail.brand,
      quantity: item.quantity ?? finance.quantity,
      units: item.units ?? finance.units,
      qty: Number(item.qty || 0),
      image: item.image || detail.images?.[0]?.image || '',
      price: finance.dprice,
      productId: product._id,
      brandId: detail._id,
      financialId: finance._id,
      barcode: finance.barcode || [],
      product: product._id,
    };
  });
};

const recalculateOrderTotals = (order) => {
  const { itemsPrice, shippingPrice, discountPercentage, discountAmount, totalPrice } =
    calcPrices(order.orderItems || [], order.discountPercentage || 0);
  order.itemsPrice = itemsPrice;
  order.shippingPrice = shippingPrice;
  order.discountPercentage = discountPercentage;
  order.discountAmount = discountAmount;
  order.totalPrice = totalPrice;
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

const canAccessAllOutlets = (loggedInUser) => {
  const role = String(loggedInUser?.role || '').trim().toUpperCase();
  return ['ADMIN', 'DIRECTOR'].includes(role);
};

const resolvePOSOrderOutlet = (req, requestedPosUserName, requestedPosLocation) => {
  const role = String(req.user?.role || '').trim().toUpperCase();
  const authenticatedPosUserName = req.user?.username || null;
  const authenticatedPosLocation = req.user?.location || null;

  if (['CASHIER', 'MANAGER', 'SUPERVISOR'].includes(role)) {
    return {
      posUserName: authenticatedPosUserName,
      posLocation: authenticatedPosLocation,
    };
  }

  return {
    posUserName: requestedPosUserName || authenticatedPosUserName,
    posLocation: requestedPosLocation || authenticatedPosLocation,
  };
};

// ------------------------------------
// Access filters
// ------------------------------------

// CASHIER => only own POS orders in own location
// MANAGER/SUPERVISOR => all POS orders in own location
// ADMIN/DIRECTOR => all orders, all sources, all locations, including null
const buildPOSAccessFilter = (loggedInUser) => {
  const base = { source: 'CASHIER' };

  if (!loggedInUser) return base;

  const role = String(loggedInUser.role || '').trim().toUpperCase();
  const username = loggedInUser.username || null;
  const location = loggedInUser.location || null;

  if (role === 'CASHIER') {
    return {
      ...base,
      posUserName: username,
      posLocation: location,
    };
  }

  if (['MANAGER', 'SUPERVISOR'].includes(role)) {
    return {
      ...base,
      posLocation: location,
    };
  }

  if (['ADMIN', 'DIRECTOR'].includes(role)) {
    return {}; // all orders including ONLINE
  }

  return base;
};

const buildPOSSettlementFilter = (loggedInUser, posUserName) => {
  const role = String(loggedInUser?.role || '').trim().toUpperCase();
  const username = loggedInUser?.username || null;
  const location = loggedInUser?.location || null;
  const filter = {
    source: 'CASHIER',
    isPosSettled: { $ne: true },
  };

  if (role === 'CASHIER') {
    filter.posUserName = username;
    filter.posLocation = location;
    return filter;
  }

  if (location) {
    filter.posLocation = location;
  }

  if (posUserName && ['ADMIN', 'DIRECTOR', 'MANAGER', 'SUPERVISOR'].includes(role)) {
    filter.posUserName = String(posUserName).trim();
  }

  return filter;
};

// ONLINE orders helper, kept separately if needed elsewhere
const buildOnlineAccessFilter = (loggedInUser) => {
  const base = { source: { $in: ['ONLINE', 'ANDROID'] } };

  if (!loggedInUser) return base;

  const role = String(loggedInUser.role || '').trim().toUpperCase();
  const location = loggedInUser.location || null;

  if (role === 'CASHIER') {
    return { _id: null };
  }

  if (['MANAGER', 'SUPERVISOR'].includes(role)) {
    return {
      ...base,
      'shippingAddress.city': location,
    };
  }

  if (['ADMIN', 'DIRECTOR'].includes(role)) {
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
    paymentBreakdown,
    remarks,
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
      image: item.image || detail.images?.[0]?.image || '',
      price: finance.dprice,
      productId: product._id,
      brandId: detail._id,
      financialId: finance._id,
      barcode: finance.barcode || [],
      product: product._id,
    };
  });

  const discountPercentage = resolvePOSOrderDiscountPercentage(req, res);
  const { itemsPrice, shippingPrice, discountAmount, totalPrice } = calcPrices(
    dbOrderItems,
    discountPercentage
  );
  const isPacked = resolveOrderStepStatus(req.body, 'isPacked', 'packed');
  const isDispatched = resolveOrderStepStatus(req.body, 'isDispatched', 'dispatched');
  const isDelivered = resolveOrderStepStatus(req.body, 'isDelivered', 'delivered');
  const now = Date.now();
  const source = 'CASHIER';
const normalizedPaymentMethod = String(paymentMethod || '').toUpperCase();
const hasGatewayPayment = Array.isArray(paymentBreakdown) && paymentBreakdown.some((payment) => {
  const channel = String(payment?.channel || '').toUpperCase();
  return channel.includes('UPI') || channel.includes('QR');
});

// UPI must stay unpaid until HDFC callback confirms success
const isPaid =
  normalizedPaymentMethod === 'CASH' ||
  (normalizedPaymentMethod === 'MULTI' && !hasGatewayPayment);


  const {
    posUserName: resolvedPosUserName,
    posLocation: resolvedPosLocation,
  } = resolvePOSOrderOutlet(req, posUserName, posLocation);

  try {
    const createdOrder = await Order.create({
      orderItems: dbOrderItems,
      user,
      shippingAddress,
      paymentMethod,
      paymentBreakdown: Array.isArray(paymentBreakdown) ? paymentBreakdown : [],
      itemsPrice,
      shippingPrice,
      discountPercentage,
      discountAmount,
      totalPrice,
      orderId,
      MK_order_id: numericMkOrderId,
      source,
      isPaid,
      paidAt: isPaid ? Date.now() : null,
      isPacked,
      isDispatched,
      isDelivered,
      packedAt: isPacked ? now : null,
      dispatchedAt: isDispatched ? now : null,
      deliveredAt: isDelivered ? now : null,
      posUserName: resolvedPosUserName,
      posLocation: resolvedPosLocation,
      remarks: remarks
        ? [createRemark(req, remarks, 'ORDER_UPDATED')]
        : [createRemark(req, `Added items on ${formatRemarkDate()}`, 'ITEMS_ADDED')],
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
// POS / ADMIN: Search / Filter Orders
// mode = latest | today | custom | phone
// ------------------------------------
const getFilteredPOSOrders = asyncHandler(async (req, res) => {
  const { mode, phone, customerNumber, posUser, location, from, to, date } = req.query;

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

  if (date) {
    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    query.createdAt = { $gte: selectedDate, $lte: end };
  }

  if (posUser) {
    query.posUserName = { $regex: String(posUser).trim(), $options: 'i' };
  }

  if (location && canAccessAllOutlets(req.user)) {
    query.posLocation = { $regex: String(location).trim(), $options: 'i' };
  }

  if (mode === 'phone' || phone || customerNumber) {
    const requestedPhone = phone || customerNumber;
    if (!requestedPhone) {
      res.status(400);
      throw new Error('phone number is required');
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .populate('user', '_id name phoneNo');

    const filtered = orders.filter(
      (order) => String(order?.user?.phoneNo || '') === String(requestedPhone)
    );

    const shaped = filtered.map((order) => ({
      _id: order._id,
      MK_order_id: order.MK_order_id,
      createdAt: order.createdAt,
      orderId: order.orderId,
      phoneNo: order?.user?.phoneNo || '',
      totalPrice: order.totalPrice || 0,
      discountPercentage: order.discountPercentage || 0,
      discountAmount: order.discountAmount || 0,
      posUserName: order.posUserName || '',
      posLocation: order.posLocation || '',
          isPaid:order.isPaid||'',
    paymentMethod:order.paymentMethod||'',
      paymentBreakdown: order.paymentBreakdown || [],
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
    discountPercentage: order.discountPercentage || 0,
    discountAmount: order.discountAmount || 0,
    posUserName: order.posUserName || '',
    posLocation: order.posLocation || '',
        isPaid:order.isPaid||'',
    paymentMethod:order.paymentMethod||'',
    paymentBreakdown: order.paymentBreakdown || [],
    source: order.source || '',
  }));

  res.json(shaped);
});

const getPOSSettlementSummary = asyncHandler(async (req, res) => {
  const filter = buildPOSSettlementFilter(req.user, req.query.posUserName);

  const rows = await Order.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          posUserName: { $ifNull: ['$posUserName', 'UNKNOWN'] },
          posLocation: { $ifNull: ['$posLocation', 'UNKNOWN'] },
        },
        amount: { $sum: { $ifNull: ['$totalPrice', 0] } },
        count: { $sum: 1 },
        lastOrderAt: { $max: '$createdAt' },
      },
    },
    { $sort: { '_id.posUserName': 1 } },
  ]);

  const cashiers = rows.map((row) => ({
    posUserName: row._id.posUserName,
    posLocation: row._id.posLocation,
    amount: Number((row.amount || 0).toFixed(2)),
    count: row.count || 0,
    lastOrderAt: row.lastOrderAt,
  }));

  res.json({
    amount: Number(cashiers.reduce((sum, row) => sum + row.amount, 0).toFixed(2)),
    count: cashiers.reduce((sum, row) => sum + row.count, 0),
    location: req.user?.location || null,
    cashiers,
  });
});

const settlePOSOrders = asyncHandler(async (req, res) => {
  const filter = buildPOSSettlementFilter(req.user, req.body?.posUserName);
  const orders = await Order.find(filter).select('_id totalPrice');

  if (orders.length === 0) {
    return res.json({
      message: 'No settlement amount pending.',
      amount: 0,
      count: 0,
    });
  }

  const amount = Number(
    orders.reduce((sum, order) => sum + Number(order.totalPrice || 0), 0).toFixed(2)
  );
  const settledAt = new Date();
  const settledBy = req.user?.username || req.user?._id?.toString() || 'POS';

  await Order.updateMany(
    { _id: { $in: orders.map((order) => order._id) } },
    {
      $set: {
        isPosSettled: true,
        posSettledAt: settledAt,
        posSettledBy: settledBy,
      },
    }
  );

  res.json({
    message: 'Settlement completed.',
    amount,
    count: orders.length,
    settledAt,
  });
});

// ------------------------------------
// POS / ADMIN: Order Details
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
    _id: item._id,
    itemId: item._id,
    sNo: index + 1,
    item: item.name || '',
    productId: item.productId || item.product || '',
    brandId: item.brandId || '',
    financialId: item.financialId || '',
    brand: item.brand || '',
    quantity: item.quantity || '',
    units: item.units || '',
    weight: `${item.quantity || ''} ${item.units || ''}`.trim(),
    qty: item.qty || 0,
    pricePerQty: item.price || 0,
    amount: (item.qty || 0) * (item.price || 0),
  }));

  res.json({
    _id: order._id,
    MK_order_id: order.MK_order_id,
    createdAt: order.createdAt,
    orderId: order.orderId,
    phoneNo: order?.user?.phoneNo || '',
    totalPrice: order.totalPrice || 0,
    discountPercentage: order.discountPercentage || 0,
    discountAmount: order.discountAmount || 0,
    posUserName: order.posUserName || '',
    posLocation: order.posLocation || '',
    isPaid:order.isPaid||'',
    paymentMethod:order.paymentMethod||'',
    paymentBreakdown: order.paymentBreakdown || [],
    source: order.source || '',
    remarks: order.remarks || [],
    items,
  });
});

// ------------------------------------
// POS / ADMIN: Top Products Report
// ------------------------------------
const getTopProductsReportPOS = asyncHandler(async (req, res) => {
  const rawDays = Number(req.query.days || 30);
  const rawLimit = Number(req.query.limit || 150);

  const days = Number.isFinite(rawDays)
    ? Math.min(Math.max(Math.floor(rawDays), 1), 3650)
    : 30;
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 500)
    : 150;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const accessFilter = buildPOSAccessFilter(req.user);
  const match = {
    ...accessFilter,
    createdAt: { $gte: startDate },
  };

  const products = await Order.aggregate([
    { $match: match },
    { $unwind: '$orderItems' },
    {
      $group: {
        _id: {
          productId: { $ifNull: ['$orderItems.productId', '$orderItems.product'] },
          brandId: '$orderItems.brandId',
          financialId: '$orderItems.financialId',
          name: '$orderItems.name',
          brand: '$orderItems.brand',
          quantity: '$orderItems.quantity',
          units: '$orderItems.units',
        },
        productId: { $first: { $ifNull: ['$orderItems.productId', '$orderItems.product'] } },
        brandId: { $first: '$orderItems.brandId' },
        financialId: { $first: '$orderItems.financialId' },
        name: { $first: '$orderItems.name' },
        brand: { $first: '$orderItems.brand' },
        quantity: { $first: '$orderItems.quantity' },
        units: { $first: '$orderItems.units' },
        image: { $first: '$orderItems.image' },
        totalQty: { $sum: { $ifNull: ['$orderItems.qty', 0] } },
        totalRevenue: {
          $sum: {
            $multiply: [
              { $ifNull: ['$orderItems.qty', 0] },
              { $ifNull: ['$orderItems.price', 0] },
            ],
          },
        },
        orderCount: { $sum: 1 },
      },
    },
    { $sort: { totalQty: -1, totalRevenue: -1, name: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        productId: { $toString: '$productId' },
        brandId: {
          $cond: [{ $ifNull: ['$brandId', false] }, { $toString: '$brandId' }, ''],
        },
        financialId: {
          $cond: [{ $ifNull: ['$financialId', false] }, { $toString: '$financialId' }, ''],
        },
        name: 1,
        brand: 1,
        quantity: 1,
        units: 1,
        image: 1,
        totalQty: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        orderCount: 1,
      },
    },
  ]);

  const rankedProducts = products.map((product, index) => ({
    ...product,
    rank: index + 1,
    productName: product.name,
    weight: `${product.quantity || ''} ${product.units || ''}`.trim(),
    qtySold: product.totalQty,
    revenue: product.totalRevenue,
  }));

  const summary = rankedProducts.reduce(
    (totals, product) => ({
      totalQty: totals.totalQty + (product.totalQty || 0),
      totalRevenue: totals.totalRevenue + (product.totalRevenue || 0),
      orderCount: totals.orderCount + (product.orderCount || 0),
    }),
    { totalQty: 0, totalRevenue: 0, orderCount: 0 }
  );

  res.json({
    days,
    limit,
    startDate,
    endDate: new Date(),
    totalRows: rankedProducts.length,
    summary: {
      ...summary,
      totalRevenue: Number(summary.totalRevenue.toFixed(2)),
    },
    products: rankedProducts,
    rows: rankedProducts,
    topProducts: rankedProducts,
  });
});

// ------------------------------------
// POS / ADMIN: Get Latest Orders
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
// POS / ADMIN: Get Order Items by Order ID / MK ID
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
// POS / ADMIN: All Orders with Timers
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
// POS / ADMIN: Orders To Pack
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
// POS / ADMIN: Orders To Dispatch
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
// POS / ADMIN: Orders To Deliver
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
// POS / ADMIN: Mark Packed
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
// POS / ADMIN: Mark Dispatched
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
// POS / ADMIN: Mark Delivered
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
// POS / ADMIN: Mark Paid
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
// POS / ADMIN: Order Management - Edit Items
// ------------------------------------
const updatePOSOrderItems = asyncHandler(async (req, res) => {
  const filter = buildOrderLookup(req.params.id);
  if (!filter) {
    res.status(400);
    throw new Error('Invalid order identifier');
  }

  const { orderItems, remarks } = req.body;
  const hasOrderItemUpdates = Array.isArray(orderItems) && orderItems.length > 0;
  const hasDiscountUpdate = hasPOSOrderDiscountRequest(req);

  if (!hasOrderItemUpdates && !hasDiscountUpdate) {
    res.status(400);
    throw new Error('orderItems array or discount percentage is required');
  }

  if (orderItems !== undefined && !hasOrderItemUpdates) {
    res.status(400);
    throw new Error('orderItems array must contain at least one item');
  }

  const accessFilter = buildPOSAccessFilter(req.user);
  const order = await Order.findOne({
    ...accessFilter,
    ...filter,
  });

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const previousItems = order.orderItems.map((item) => item.toObject());
  const normalizedItems = hasOrderItemUpdates
    ? await normalizeOrderItemsFromDB(orderItems)
    : previousItems;
  const discountPercentage = resolvePOSOrderDiscountPercentage(
    req,
    res,
    order.discountPercentage || 0
  );

  if (hasOrderItemUpdates) {
    order.orderItems = normalizedItems;
  }
  order.discountPercentage = discountPercentage;
  recalculateOrderTotals(order);
  order.remarks = order.remarks || [];
  order.remarks.push(
    createRemark(
      req,
      remarks ||
        (hasOrderItemUpdates
          ? buildDefaultItemEditRemark(previousItems, normalizedItems)
          : `Updated order discount to ${discountPercentage}% on ${formatRemarkDate()}`),
      hasOrderItemUpdates ? 'ITEMS_UPDATED' : 'ORDER_UPDATED'
    )
  );

  const updatedOrder = await order.save();
  res.json(updatedOrder);
});

// ------------------------------------
// POS / ADMIN: Order Management - Delete Item
// ------------------------------------
const deletePOSOrderItem = asyncHandler(async (req, res) => {
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

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  const itemId = String(req.params.itemId);
  const itemIndex = order.orderItems.findIndex((item) => String(item._id) === itemId);

  if (itemIndex === -1) {
    res.status(404);
    throw new Error('Order item not found');
  }

  const [removedItem] = order.orderItems.splice(itemIndex, 1);
  recalculateOrderTotals(order);
  order.remarks = order.remarks || [];
  order.remarks.push(
    createRemark(
      req,
      req.body?.remarks ||
        `Removed items (${removedItem.name}) on ${formatRemarkDate()}`,
      'ITEMS_REMOVED'
    )
  );

  const updatedOrder = await order.save();
  res.json(updatedOrder);
});

// ------------------------------------
// POS / ADMIN: Order Management - Delete Order
// ------------------------------------
const deletePOSOrder = asyncHandler(async (req, res) => {
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

  if (!order) {
    res.status(404);
    throw new Error('Order not found');
  }

  await Order.deleteOne({ _id: order._id });
  res.json({ message: 'Order deleted successfully', deletedOrderId: order._id });
});

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
  getPOSSettlementSummary,
  settlePOSOrders,
  getTopProductsReportPOS,
  getOnlineOrders,
  getOnlineOrderDetails,
  updatePOSOrderItems,
  deletePOSOrderItem,
  deletePOSOrder,
};
