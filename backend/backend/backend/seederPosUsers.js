import mongoose from 'mongoose';
import dotenv from 'dotenv';
import colors from 'colors';
dotenv.config();
import PosUser from './models/PosUserModel.js';
import connectDB from './config/db.js';


connectDB();

// Define default POS users (plain passwords, will be hashed on save)
const posUsers = [
  {
    username: 'admin1',
    password: 'admin123',
    role: 'ADMIN',
    isActive: true,
  },
  {
    username: 'cashier1',
    password: 'cashier123',
    role: 'CASHIER',
    isActive: true,
  },
  {
    username: 'inventory1',
    password: 'stock123',
    role: 'INVENTORY',
    isActive: true,
  },
  {
  username: 'stockadmin',
  password: 'securepass123',
  role: 'INVENTORY',
  isActive: true
},
{
  username: 'onlinecashier1',
  password: 'securepass123',
  role: 'ONLINE_CASHIER',
  isActive: true
},{
  username: 'hybridcashier1',
  password: 'securepass123',
  role: 'HYBRID_CASHIER',
  isActive: true
},

  {
    username: 'owner1',
    password: 'proprietor123',
    role: 'PROPRIETOR',
    isActive: true,
  },
  {
  username: 'packing1',
  password: 'securepass123',
  role: 'PACKING_AGENT'
},
{
  username: 'online_manager1',
  password: 'strongpass123',
  role: 'ONLINE_ORDER_MANAGER'
},{
  username: 'dispatch_agent1',
  password: 'securepass123',
  role: 'DISPATCH_AGENT'
},{
  username: 'delivery_agent1',
  password: 'passdelivery123',
  role: 'DELIVERY_AGENT'
},{
  username: 'hybrid_agent1',
  password: 'hybridpass456',
  role: 'HYBRID_AGENT'
}




];

const importData = async () => {
  try {
    await PosUser.deleteMany();

    // Use .save() so pre('save') handles hashing
    for (let user of posUsers) {
      const newUser = new PosUser(user);
      await newUser.save();
    }

    console.log('POS User Data Imported!'.green.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ ${error}`.red.inverse);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await PosUser.deleteMany();
    console.log('POS User Data Destroyed!'.red.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ ${error}`.red.inverse);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
