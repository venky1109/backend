import jwt from 'jsonwebtoken';
import asyncHandler from './asyncHandler.js';
import PosUser from '../models/PosUserModel.js';

export const protectPOS = asyncHandler(async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    // console.log('🔍 Verifying token with:', process.env.JWT_SECRET_POS);
    const decoded = jwt.verify(token, process.env.JWT_SECRET_POS);

    // Fetch POS user by decoded ID
    const user = await PosUser.findById(decoded.id).select('-password');
  
    


    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'POS user not found or deactivated' });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('POS token error:', err.message);
    return res.status(401).json({ message: 'Invalid token' });
  }
});

// ✅ Optional role check middleware
export const isAdminOrProp = (req, res, next) => {
  const { user } = req;
  if (user && ['ADMIN', 'PROPRIETOR'].includes(user.role)) {
    return next();
  }
  return res.status(403).json({ message: 'Admin or Proprietor access required' });
};
export const cashierOrAdmin = (req, res, next) => {
  const allowedRoles = ['CASHIER', 'ONLINE_CASHIER', 'HYBRID_CASHIER', 'ADMIN'];

  if (req.user && allowedRoles.includes(req.user.role)) {
    return next();
  }

};

export const admin = (req, res, next) => {
  if (req.user && req.user.role === 'ADMIN') {
    next();
  } else {
    res.status(403);
    throw new Error('Not authorized as admin');
  }
};

export const onlineOrderManager = (req, res, next) => {
  if (req.user && req.user.role === 'ONLINE_ORDER_MANAGER') {
    return next();
  }
  return res.status(403).json({ message: 'Access denied: ONLINE_ORDER_MANAGER only' });
};


export const packingAgent = (req, res, next) => {
  const roles = ['PACKING_AGENT', 'HYBRID_AGENT'];
  if (req.user && roles.includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({ message: 'Access denied: PACKING_AGENT or HYBRID_AGENT only' });
};


export const dispatchAgent = (req, res, next) => {
  const roles = ['DISPATCH_AGENT', 'HYBRID_AGENT'];
  if (req.user && roles.includes(req.user.role)) {
    return next();
  }
  return res.status(403).json({ message: 'Access denied: DISPATCH_AGENT or HYBRID_AGENT only' });
};


export const deliveryAgent = (req, res, next) => {
  if (req.user && req.user.role === 'DELIVERY_AGENT') {
    return next();
  }
  return res.status(403).json({ message: 'Access denied: DELIVERY_AGENT only' });
};
