import PosUser from '../models/PosUserModel.js';
import generateTokenPos from '../utils/generateTokenPos.js';
import { query as pgQuery } from '../config/pg.js';

const normalizeRole = (role) => String(role || '').trim().toUpperCase();

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
    const role = normalizeRole(user.role);

    // Directors are not restricted to a location while logging in.
    if (role !== 'DIRECTOR' && location && user.location !== location) {
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
  const { username, password, role, isActive, location, balance } = req.body;
  const normalizedRole = normalizeRole(role);

  const exists = await PosUser.findOne({ username });
  if (exists) return res.status(400).json({ message: 'Username already exists' });

  const user = await PosUser.create({
    username,
    password,
    role: normalizedRole,
    isActive: isActive ?? true,
    location: location ?? '',
    balance: balance ?? 0,
  });
  res.status(201).json({ message: 'POS user created', _id: user._id });
};


const canManagePosUsers = (role) =>
  ['ADMIN', 'PROPRIETOR', 'DIRECTOR'].includes(normalizeRole(role));

const buildRoleFilter = (role) => {
  const normalizedRole = normalizeRole(role);

  if (!normalizedRole) return {};

  if (normalizedRole === 'DELIVERY') {
    return { role: /DELIVERY/i };
  }

  return { role: normalizedRole };
};

// @desc    Get POS users
// @route   GET /api/pos_users
export const getPosUsers = async (req, res) => {
  const requestedRole = req.query.role;
  const isManager = canManagePosUsers(req.user?.role);
  const filter = requestedRole
    ? buildRoleFilter(requestedRole)
    : isManager
      ? {}
      : { role: /DELIVERY/i };

  const users = await PosUser.find(filter).select('-password');
  res.json(users);
};

// @desc    Get POS user role by username
// @route   GET /api/posusers/role/:username
export const getPosUserRoleByUsername = async (req, res) => {
  const user = await PosUser.findOne({ username: req.params.username }).select('role');

  if (!user) {
    return res.status(404).json({ message: 'POS user not found' });
  }

  res.json({ role: user.role });
};

export const getLoginLocations = async (_req, res) => {
  try {
    const userLocations = await PosUser.distinct('location', {
      location: { $exists: true, $nin: [null, ''] },
    });

    const catalogLocations = await pgQuery(
      `
      SELECT outlet_name AS location
      FROM catalog.outlets
      WHERE outlet_name IS NOT NULL
      UNION
      SELECT warehouse_name AS location
      FROM catalog.warehouses
      WHERE warehouse_name IS NOT NULL
      ORDER BY location ASC
      `
    ).catch(() => ({ rows: [] }));

    const locations = [...userLocations, ...catalogLocations.rows.map((row) => row.location)]
      .map((location) => String(location || '').trim())
      .filter(Boolean)
      .filter((location, index, list) =>
        list.findIndex((item) => item.toLowerCase() === location.toLowerCase()) === index
      )
      .sort((a, b) => a.localeCompare(b));

    res.json({ locations });
  } catch (error) {
    console.error('Failed to fetch login locations:', error);
    res.status(500).json({ message: 'Failed to fetch login locations' });
  }
};

// @desc    Update POS user
// @route   PUT /api/pos_users/:id
export const updatePosUser = async (req, res) => {
  const user = await PosUser.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'POS User not found' });

  user.username = req.body.username || user.username;
  user.role = req.body.role ? normalizeRole(req.body.role) : user.role;
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
