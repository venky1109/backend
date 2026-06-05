import jwt from 'jsonwebtoken';
import asyncHandler from './asyncHandler.js';
import PosUser from '../models/PosUserModel.js';


// 🔐 Protect POS routes (JWT)
export const protectPOS = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET_POS);

    const user = await PosUser.findById(decoded.id).select('-password');

    if (!user || !user.isActive) {
      return res.status(401).json({
        message: 'POS user not found or deactivated',
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('POS token error:', err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
});


// 🔁 Generic role checker
const allowRoles = (roles, message = 'Access denied') => {
  return (req, res, next) => {
    const role = String(req.user?.role || '').trim().toUpperCase();

    if (['ADMIN', 'DIRECTOR'].includes(role) || roles.includes(role)) {
      return next();
    }

    return res.status(403).json({ message });
  };
};


// ✅ Catalog + Inventory + Purchase + Dispatch
export const catalogInventoryAccess = allowRoles(
  ['ADMIN', 'DIRECTOR', 'STOCK_MANAGER', 'CASHIER'],
  'Access denied: ADMIN, DIRECTOR, STOCK_MANAGER, or CASHIER only'
);


// ✅ Admin / Proprietor
export const isAdminOrProp = allowRoles(
  ['ADMIN', 'PROPRIETOR', 'DIRECTOR'],
  'Admin, Proprietor, or Director access required'
);

// POS user lookup is needed by order/UPI flows to assign delivery users.
export const posUserReadAccess = allowRoles(
  [
    'ADMIN',
    'PROPRIETOR',
    'DIRECTOR',
    'CASHIER',
    'ONLINE_CASHIER',
    'HYBRID_CASHIER',
    'SUPERVISOR',
    'DELIVERY_AGENT',
  ],
  'POS user lookup access required'
);


// ✅ Admin / Inventory support
export const isAdminOrInventory = allowRoles(
  ['ADMIN', 'DIRECTOR', 'INVENTORY', 'STOCK_MANAGER'],
  'Admin or Inventory access required'
);


// ✅ Cashier / Admin
export const cashierOrAdmin = allowRoles(
  ['CASHIER', 'ONLINE_CASHIER', 'HYBRID_CASHIER', 'SUPERVISOR', 'ADMIN'],
  'Cashier, Supervisor, or Admin access required'
);


// ✅ Allow all authenticated users
export const allowAllRoles = (req, res, next) => {
  if (req.user && req.user.role) {
    return next();
  }

  return res.status(403).json({
    message: 'Access denied: role missing or unauthorized',
  });
};


// ✅ Admin only
export const admin = allowRoles(
  ['ADMIN', 'DIRECTOR'],
  'Not authorized as admin'
);


// ✅ Online order manager
export const onlineOrderManager = allowRoles(
  ['ADMIN', 'DIRECTOR', 'ONLINE_ORDER_MANAGER'],
  'Access denied: ADMIN, DIRECTOR, or ONLINE_ORDER_MANAGER only'
);


// ✅ Packing agents
export const packingAgent = allowRoles(
  ['ADMIN', 'DIRECTOR', 'PACKING_AGENT', 'HYBRID_AGENT'],
  'Access denied: ADMIN, DIRECTOR, PACKING_AGENT, or HYBRID_AGENT only'
);


// ✅ Dispatch agents
export const dispatchAgent = allowRoles(
  ['ADMIN', 'DIRECTOR', 'DISPATCH_AGENT', 'HYBRID_AGENT'],
  'Access denied: ADMIN, DIRECTOR, DISPATCH_AGENT, or HYBRID_AGENT only'
);


// ✅ Delivery agents
export const deliveryAgent = allowRoles(
  ['ADMIN', 'DIRECTOR', 'DELIVERY_AGENT'],
  'Access denied: ADMIN, DIRECTOR, or DELIVERY_AGENT only'
);


// 💰 Payment access control
export const paymentAccess = (req, res, next) => {
  const role = String(req.user?.role || '').trim().toUpperCase();

  if (!role) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  if (['ADMIN', 'DIRECTOR'].includes(role)) {
    return next();
  }

  // 👁 View payments
  if (req.method === 'GET') {
    if (['CASHIER', 'STOCK_MANAGER'].includes(role)) {
      return next();
    }
  }

  // ➕ Create payments
  if (req.method === 'POST') {
    if (['CASHIER'].includes(role)) {
      return next();
    }
  }

  // ✏️ Update / ❌ Delete
  if (['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(403).json({
      message: 'Access denied for payments',
    });
  }

  return res.status(403).json({
    message: 'Access denied for payments',
  });
};


// 📦 Strict stock control (recommended)
export const stockManagerOnly = allowRoles(
  ['ADMIN', 'DIRECTOR', 'STOCK_MANAGER'],
  'Access denied: ADMIN, DIRECTOR, or STOCK_MANAGER only'
);
