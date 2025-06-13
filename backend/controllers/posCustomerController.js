import asyncHandler from '../middleware/asyncHandler.js';
import User from '../models/userModel.js';
import dotenv from 'dotenv';
dotenv.config();
// ✅ GET customer by phone number (POS)
const getCustomerByPhoneNoPOS = asyncHandler(async (req, res) => {
  const user = await User.findOne({ phoneNo: req.params.phoneNo }).select('-password');
  if (!user) {
    res.status(404);
    throw new Error('Customer not found');
  }
  res.json(user);
});

// // ✅ POST create new customer (POS)
// const createCustomerPOS = asyncHandler(async (req, res) => {
//   const { name, phoneNo, password } = req.body;

//   const exists = await User.findOne({ phoneNo });
//   if (exists) {
//     res.status(400);
//     throw new Error('Customer already exists');
//   }

//   const user = await User.create({ name, phoneNo, password });
//   if (user) {
//     res.status(201).json({
//       _id: user._id,
//       name: user.name,
//       phoneNo: user.phoneNo,
//       isAdmin: user.isAdmin,
//     });
//   } else {
//     res.status(400);
//     throw new Error('Invalid customer data');
//   }
// });


const createCustomerPOS = asyncHandler(async (req, res) => {
  const { name, phone, deliveryAddress = {}, location = {} } = req.body;
  console.log(req.body);

  if (!phone || !name) {
    res.status(400);
    throw new Error('Name and phone number are required');
  }

//   const existing = await User.findOne({ phone });
//   if (existing) {
//     res.status(400);
//     throw new Error('Customer already exists');
//   }

  // 🔐 Generate default password using env and logic
  const prefix = process.env.REACT_APP_PASSWORD_PREFIX || 'Mk@';
  const suffix = process.env.REACT_APP_PASSWORD_SUFFIX || '#';
  const year = new Date().getFullYear();
  const last4Digits = phone.slice(-4);
  const generatedPassword = `${prefix}${last4Digits}${suffix}${year}`;

  const user = await User.create({
    name,
    phoneNo:phone,
    password: generatedPassword,
    deliveryAddress: {
      street: deliveryAddress.street || 'N/A',
      city: deliveryAddress.city || 'Unknown',
      postalCode: deliveryAddress.postalCode || '000000',
    },
    location: {
      latitude: location.latitude || 0,
      longitude: location.longitude || 0,
    },
  });

  if (user) {
    res.status(201).json({
      _id: user._id,
      name: user.name,
      phoneNo: user.phoneNo,
      deliveryAddress: user.deliveryAddress,
      location: user.location,
    });
  } else {
    res.status(400);
    throw new Error('Invalid customer data');
  }
});

// @desc    Update customer by phone number
// @route   PUT /api/users/pos/phone/:phoneNo
// @access  POS Admin or Cashier
const updateCustomerByPhoneNoPOS = asyncHandler(async (req, res) => {
  const { phoneNo } = req.params;

  const customer = await User.findOne({ phoneNo });

  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  customer.name = req.body.name || customer.name;
  customer.phoneNo = req.body.phoneNo || customer.phoneNo;

  customer.deliveryAddress = req.body.deliveryAddress || {
    street: 'Default Street',
    city: 'Default City',
    postalCode: '00000'
  };

  customer.location = req.body.location || {
    latitude: 0.0,
    longitude: 0.0
  };

  const updated = await customer.save();

  res.json({
    _id: updated._id,
    name: updated.name,
    phoneNo: updated.phoneNo,
    deliveryAddress: updated.deliveryAddress,
    location: updated.location
  });
});


// ✅ DELETE customer (POS admin only)
const deleteCustomerPOS = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error('Customer not found');
  }

  await User.deleteOne({ _id: user._id });
  res.json({ message: 'Customer deleted successfully' });
});

// @desc    Get customers with optional filters (city, date range)
// @route   GET /api/users/pos
// @access  POS: ADMIN only
const getFilteredCustomersPOS = asyncHandler(async (req, res) => {
  const { city, fromDate, toDate, phoneNo, name, page = 1, limit = 20 } = req.query;

  const filter = { isDeleted: { $ne: true } };

  if (city?.trim()) {
    filter['deliveryAddress.city'] = city.trim();
  }

  if (phoneNo?.trim()) {
    filter.phoneNo = { $regex: phoneNo.trim(), $options: 'i' };
  }

  if (name?.trim()) {
    filter.name = { $regex: name.trim(), $options: 'i' };
  }

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) filter.createdAt.$lte = new Date(toDate);
  }

  const skip = (page - 1) * limit;

  const customers = await User.find(filter)
    .select('-password')
    .skip(skip)
    .limit(parseInt(limit))
    .sort({ createdAt: -1 });

  // ✅ Don't throw if no customers
  res.json({
    results: customers,
    page: parseInt(page),
    limit: parseInt(limit),
    total: customers.length,
  });
});


export {
  getCustomerByPhoneNoPOS,
  createCustomerPOS,
  updateCustomerByPhoneNoPOS,
  deleteCustomerPOS,
  getFilteredCustomersPOS,
};
