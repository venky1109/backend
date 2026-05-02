import PosUser from '../models/PosUserModel.js';
import generateTokenPos from '../utils/generateTokenPos.js';

// @desc    Login POS user
// @route   POST /api/pos_users/login
export const loginPosUser = async (req, res) => {
  const { username, password, location } = req.body;

  const user = await PosUser.findOne({ username });

  if (user && await user.matchPassword(password)) {
    if (!user.isActive) {
      return res.status(403).json({ message: 'User is deactivated' });
    }

    // ✅ Check if location matches
    if (location && user.location !== location) {
      return res.status(403).json({ message: 'Invalid location' });
    }

    const token = generateTokenPos(user);
    res.json({
      _id: user._id,
      username: user.username,
      role: user.role,
      location: user.location,
      token,
    });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
};


// @desc    Register new POS user
// @route   POST /api/pos_users


export const registerPosUser = async (req, res) => {
  const { username, password, role, location } = req.body;

  const exists = await PosUser.findOne({ username });
  if (exists) return res.status(400).json({ message: 'Username already exists' });

  const user = await PosUser.create({ username, password, role, location });
  res.status(201).json({ message: 'POS user created', _id: user._id });
};


// @desc    Get all POS users (admin/proprietor only)
// @route   GET /api/pos_users
export const getPosUsers = async (req, res) => {
  const users = await PosUser.find({});
  res.json(users);
};

// @desc    Update POS user
// @route   PUT /api/pos_users/:id
export const updatePosUser = async (req, res) => {
  const user = await PosUser.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'POS User not found' });

  user.username = req.body.username || user.username;
  user.role = req.body.role || user.role;
  user.isActive = req.body.isActive ?? user.isActive;
  user.location = req.body.location ?? user.location; // ✅ added line
  user.balance = req.body.balance ?? user.balance;
  if (req.body.password) user.password = req.body.password;

  const updatedUser = await user.save();
  res.json(updatedUser);
};
// @desc    Set POS user balance (overwrite)
// @route   PATCH /api/pos_users/:id/balance
// @access  ADMIN/PROPRIETOR
export const setPosUserBalance = async (req, res) => {
  const { id } = req.params;
  const { balance } = req.body;

  if (balance === undefined || balance === null || isNaN(Number(balance))) {
    return res.status(400).json({ message: 'balance is required and must be a number' });
  }

  const user = await PosUser.findByIdAndUpdate(
    id,
    { $set: { balance: Number(balance) } },
    { new: true, runValidators: true, projection: 'username role location isActive balance createdAt updatedAt' }
  );

  if (!user) return res.status(404).json({ message: 'POS User not found' });
  res.json(user);
};
// @desc    Adjust POS user balance by delta (add/subtract)
// @route   PATCH /api/pos_users/:id/balance/adjust
// @access  ADMIN/PROPRIETOR
export const adjustPosUserBalance = async (req, res) => {
  const { id } = req.params;
  const { delta } = req.body;

  if (delta === undefined || delta === null || isNaN(Number(delta))) {
    return res.status(400).json({ message: 'delta is required and must be a number' });
  }

  const user = await PosUser.findByIdAndUpdate(
    id,
    { $inc: { balance: Number(delta) } },
    { new: true, projection: 'username role location isActive balance createdAt updatedAt' }
  );

  if (!user) return res.status(404).json({ message: 'POS User not found' });
  res.json(user);
};

// @desc    Get POS user balance
// @route   GET /api/posusers/balance/:id
// @access  Private (Cashier/Admin)
export const getPosUserBalance = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await PosUser.findById(id)
      .select("username role balance"); // Only fetch necessary fields

    if (!user) {
      return res.status(404).json({ message: "POS User not found" });
    }

    res.json({
      _id: user._id,
      username: user.username,
      role: user.role,
      balance: user.balance
    });
  } catch (error) {
    console.error("Error fetching POS user balance:", error);
    res.status(500).json({ message: "Server error" });
  }
};


// @desc    Delete POS user
// @route   DELETE /api/pos_users/:id
export const deletePosUser = async (req, res) => {
  const user = await PosUser.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'POS User not found' });

  await user.remove();
  res.json({ message: 'POS user deleted' });
};
