import jwt from 'jsonwebtoken';
import asyncHandler from './asyncHandler.js';
import User from '../models/userModel.js';
import PosUser from '../models/PosUserModel.js'; 

// Middleware: protectEither (works for POS or regular)
const protectEither = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies?.jwt) {
    token = req.cookies.jwt;
  }

  if (!token) {
    res.status(401);
    throw new Error('Not authorized, no token');
  }

//   console.log('🔐 Token:', req.headers.authorization);


  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);


    let user = await User.findById(decoded.id).select('-password');

if (!user) {
  user = await PosUser.findById(decoded.id).select('-password');
  if (!user) {
    res.status(401);
    throw new Error('User not found in either collection');
  }
}

    req.user = user;
    next();
  } catch (error) {
    console.error('JWT Error in protectEither:', error);
    res.status(401);
    throw new Error('Not authorized, token failed');
  }
});

export default protectEither;