import mongoose from 'mongoose';
import dotenv from 'dotenv';
import colors from 'colors';
import users from './data/users.js';
import User from './models/userModel.js';
import connectDB from './config/db.js';

dotenv.config();

connectDB();

const importData = async () => {
  try {
    // Delete all users from the User collection
    await User.deleteMany();

    // Insert the new users into the User collection
    const createdUsers = await User.insertMany(users);

    console.log('User Data Imported!'.green.inverse);
    process.exit();
  } catch (error) {
    console.error(`${error}`.red.inverse);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    // Delete all users from the User collection
    await User.deleteMany();

    console.log('User Data Destroyed!'.red.inverse);
    process.exit();
  } catch (error) {
    console.error(`${error}`.red.inverse);
    process.exit(1);
  }
};

// Check the command-line argument to determine which action to perform
if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
