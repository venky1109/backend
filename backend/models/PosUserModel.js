import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();


const defaultRoles = [
  'CASHIER',             // POS cashier
  'ONLINE_CASHIER',      // Online order handler only
  'HYBRID_CASHIER',      // Can manage both online + POS
  'INVENTORY',           // Manages stock & product catalog
  'ADMIN',               // Full admin access
  'PROPRIETOR',          // Business owner role

  // ✅ Newly added roles for order flow
  'ONLINE_ORDER_MANAGER', // Manages all online orders and their stages
  'PACKING_AGENT',        // Handles packing stage
  'DISPATCH_AGENT',       // Handles dispatch stage
  'DELIVERY_AGENT',       // Handles delivery stage
  'HYBRID_AGENT',         // Can handle both packing and dispatch
];


// const allowedRoles = process.env.REACT_APP_POS_USER_ROLES?.split(',') || defaultRoles;
const envRoles = process.env.REACT_APP_POS_USER_ROLES?.split(',').map(r => r.trim()).filter(Boolean);
const allowedRoles = Array.isArray(envRoles) && envRoles.length > 0 ? envRoles : defaultRoles;





const posUserSchema = mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      required: true,
      enum: {
        values: allowedRoles,
        message: 'Invalid role assigned',
      },
      default: allowedRoles.includes('CASHIER') ? 'CASHIER' : allowedRoles[0],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    location: {
      type: String,
      required: false,
      default: '',
    },
    balance: {
      type: Number,
      default: 0, // 💰 initial balance is 0
    },
  },
  { timestamps: true }
);
posUserSchema.methods.matchPassword = async function (enteredPassword) {
  // console.log('Entered Password:', enteredPassword);
  // console.log('Stored Hash:', this.password);
  // console.log('Hash Length:', this.password.length);
  // console.log('Trimmed:', `"${this.password}"`);

  try {
    const isMatch = await bcrypt.compare(enteredPassword, this.password);
    // console.log('Password Match Result:', isMatch);
    return isMatch;
  } catch (err) {
    console.error('Compare failed:', err);
    return false;
  }
};


// Encrypt password
posUserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const PosUser = mongoose.models.PosUser || mongoose.model('PosUser', posUserSchema);
export default PosUser;

