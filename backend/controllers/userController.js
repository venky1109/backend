import asyncHandler from '../middleware/asyncHandler.js';
import generateToken from '../utils/generateToken.js';
import User from '../models/userModel.js';

// Controller functions

const authUser = asyncHandler(async (req, res) => {
  const { phoneNo, password } = req.body;
  const user = await User.findOne({ phoneNo });

  if (user && (await user.matchPassword(password))) {
    generateToken(res, user._id);
    res.json({
      _id: user._id,
      name: user.name,
      phoneNo: user.phoneNo,
      isAdmin: user.isAdmin,
      deliveryAddress: user.deliveryAddress,
      location: user.location,
    });
  } else {
    res.status(401);
    throw new Error('Invalid phone number or password');
  }
});

const getUserByPhoneNo = asyncHandler(async (req, res) => {
  const user = await User.findOne({ phoneNo: req.params.phoneNo });

  if (user) {
    res.status(400);
    throw new Error('User already exists');
  } else {
    res.json({ message: 'User not found' });
  }
});

const registerUser = asyncHandler(async (req, res) => {
  const { name, phoneNo, password, deliveryAddress, location } = req.body;

  const userExists = await User.findOne({ phoneNo });

  if (userExists) {
    res.status(400);
    throw new Error('User already exists');
  }

  const user = await User.create({
    name,
    phoneNo,
    password,
    deliveryAddress: deliveryAddress || {},
    location: location || {},
  });

  if (user) {
    generateToken(res, user._id);
    res.status(201).json({
      _id: user._id,
      name: user.name,
      phoneNo: user.phoneNo,
      isAdmin: user.isAdmin,
      deliveryAddress: user.deliveryAddress,
      location: user.location,
    });
  } else {
    res.status(400);
    throw new Error('Invalid user data');
  }
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { phoneNo, password } = req.body;
  const user = await User.findOne({ phoneNo });

  if (!user) {
    res.status(404);
    throw new Error('User not found');
  }

  user.password = password;
  await user.save();
  generateToken(res, user._id);

  res.json({
    _id: user._id,
    name: user.name,
    phoneNo: user.phoneNo,
    isAdmin: user.isAdmin,
  });
});

const logoutUser = (req, res) => {
  res.clearCookie('jwt');
  res.status(200).json({ message: 'Logged out successfully' });
};

const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      phoneNo: user.phoneNo,
      isAdmin: user.isAdmin,
      deliveryAddress: user.deliveryAddress,
      location: user.location,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.name = req.body.name || user.name;
    user.phoneNo = req.body.phoneNo || user.phoneNo;

    if (req.body.password) {
      user.password = req.body.password;
    }

    if (req.body.deliveryAddress) {
      user.deliveryAddress = {
        street: req.body.deliveryAddress.street || user.deliveryAddress.street,
        city: req.body.deliveryAddress.city || user.deliveryAddress.city,
        postalCode: req.body.deliveryAddress.postalCode || user.deliveryAddress.postalCode,
      };
    }

    if (req.body.location) {
      user.location = {
        latitude: req.body.location.latitude || user.location.latitude,
        longitude: req.body.location.longitude || user.location.longitude,
      };
    }

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      phoneNo: updatedUser.phoneNo,
      isAdmin: updatedUser.isAdmin,
      deliveryAddress: updatedUser.deliveryAddress,
      location: updatedUser.location,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const getUsers = asyncHandler(async (req, res) => {
  const users = await User.find({});
  res.json(users);
});

const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    if (user.isAdmin) {
      res.status(400);
      throw new Error('Cannot delete admin user');
    }
    await User.deleteOne({ _id: user._id });
    res.json({ message: 'User removed' });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');

  if (user) {
    res.json({
      _id: user._id,
      name: user.name,
      phoneNo: user.phoneNo,
      isAdmin: user.isAdmin,
      deliveryAddress: user.deliveryAddress,
      location: user.location,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (user) {
    user.name = req.body.name || user.name;
    user.phoneNo = req.body.phoneNo || user.phoneNo;
    user.isAdmin = Boolean(req.body.isAdmin);

    const updatedUser = await user.save();

    res.json({
      _id: updatedUser._id,
      name: updatedUser.name,
      phoneNo: updatedUser.phoneNo,
      isAdmin: updatedUser.isAdmin,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const getAddressAndLocation = asyncHandler(async (req, res) => {
  // console.log('Request received for user address and location');
  // console.log('User ID from token:', req);

  const user = await User.findById(req.user._id);

  if (user) {
    // console.log('User found:', user);
    // console.log('Delivery Address:', user.deliveryAddress);
    // console.log('Location:', user.location);

    res.json({
      deliveryAddress: user.deliveryAddress,
      location: user.location,
    });
  } else {
    console.log('Error: User not found');
    res.status(404);
    throw new Error('User not found');
  }
});

const updateAddressAndLocation = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    if (req.body.deliveryAddress) {
      user.deliveryAddress = {
        street: req.body.deliveryAddress.street || user.deliveryAddress.street,
        city: req.body.deliveryAddress.city || user.deliveryAddress.city,
        postalCode: req.body.deliveryAddress.postalCode || user.deliveryAddress.postalCode,
      };
    }

    if (req.body.location) {
      user.location = {
        latitude: req.body.location.latitude || user.location.latitude,
        longitude: req.body.location.longitude || user.location.longitude,
      };
    }

    const updatedUser = await user.save();

    res.json({
      deliveryAddress: updatedUser.deliveryAddress,
      location: updatedUser.location,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const deleteAddressAndLocation = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.deliveryAddress = {};
    user.location = {};

    await user.save();

    res.json({ message: 'Address and location removed' });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

const addAddressAndLocation = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id);

  if (user) {
    user.deliveryAddress = {
      street: req.body.deliveryAddress.street,
      city: req.body.deliveryAddress.city,
      postalCode: req.body.deliveryAddress.postalCode,
    };

    user.location = {
      latitude: req.body.location.latitude,
      longitude: req.body.location.longitude,
    };

    const updatedUser = await user.save();

    res.status(201).json({
      deliveryAddress: updatedUser.deliveryAddress,
      location: updatedUser.location,
    });
  } else {
    res.status(404);
    throw new Error('User not found');
  }
});

export {
  authUser,
  getUserByPhoneNo,
  registerUser,
  forgotPassword,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  getUsers,
  deleteUser,
  getUserById,
  updateUser,
  getAddressAndLocation,
  updateAddressAndLocation,
  deleteAddressAndLocation,
  addAddressAndLocation,
};
