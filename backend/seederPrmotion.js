import mongoose from 'mongoose';
import dotenv from 'dotenv';
import colors from 'colors';
import promotions from './data/promotions.js'; // Correctly import the default export
import Promotion from './models/promotionModel.js';
import connectDB from './config/db.js';

dotenv.config();

connectDB();

const importData = async () => {
  try {
    await Promotion.deleteMany();
    const createdPromotions = await Promotion.insertMany(promotions);
    console.log('Promotion Data Imported!'.green.inverse);
    process.exit();
  } catch (error) {
    console.error(`${error}`.red.inverse);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    await Promotion.deleteMany();
    console.log('Promotion Data Destroyed!'.red.inverse);
    process.exit();
  } catch (error) {
    console.error(`${error}`.red.inverse);
    process.exit(1);
  }
};

if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
