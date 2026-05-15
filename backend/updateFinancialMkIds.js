import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/db.js';
import Product from './models/productModel.js';
import { assignFinancialMkIds } from './utils/financialMkid.js';

dotenv.config({ path: '../.env' });
dotenv.config();

const updateFinancialMkIds = async () => {
  try {
    await connectDB();

    const result = await assignFinancialMkIds(Product);

    console.log(
      `MKID update complete. Updated ${result.updatedFinancials} of ${result.totalFinancials} financial records.`
    );

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error(`MKID update failed: ${error.message}`);
    await mongoose.connection.close();
    process.exit(1);
  }
};

updateFinancialMkIds();
