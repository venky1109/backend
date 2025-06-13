import PosUser from '../models/PosUserModel.js';
import generateTokenPos from '../utils/generateTokenPos.js';

// @desc    Login POS user
// @route   POST /api/pos_users/login
export const loginPosUser = async (req, res) => {
  const { username, password } = req.body;

  const user = await PosUser.findOne({ username });

//   console.log({
//     enteredPassword: password,
//     storedHash: user?.password,
//   });

  if (user && await user.matchPassword(password)) {
    if (!user.isActive) {
      return res.status(403).json({ message: 'User is deactivated' });
    }

    const token = generateTokenPos(user);
    res.json({
      _id: user._id,
      username: user.username,
      role: user.role,
      token,
    });
  } else {
    res.status(401).json({ message: 'Invalid credentials' });
  }
};

// @desc    Register new POS user
// @route   POST /api/pos_users
export const registerPosUser = async (req, res) => {
  const { username, password, role } = req.body;
  const exists = await PosUser.findOne({ username });
  if (exists) return res.status(400).json({ message: 'Username already exists' });

  const user = await PosUser.create({ username, password, role });
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
  if (req.body.password) user.password = req.body.password;

  const updatedUser = await user.save();
  res.json(updatedUser);
};

// @desc    Delete POS user
// @route   DELETE /api/pos_users/:id
export const deletePosUser = async (req, res) => {
  const user = await PosUser.findById(req.params.id);
  if (!user) return res.status(404).json({ message: 'POS User not found' });

  await user.remove();
  res.json({ message: 'POS user deleted' });
};
