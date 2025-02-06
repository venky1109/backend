import mongoose from 'mongoose';
import dotenv from 'dotenv';
import colors from 'colors';
import slugify from 'slugify';
import users from './data/users.js';
import products from './data/products.js';
import User from './models/userModel.js';
import Product from './models/productModel.js';
import Order from './models/orderModel.js';
import connectDB from './config/db.js';

dotenv.config();
connectDB();

// ✅ Helper function to safely convert `_id`
const convertObjectId = (id) => {
  if (!id) return new mongoose.Types.ObjectId(); // Generate new ID if missing
  if (typeof id === 'object' && id.$oid) return new mongoose.Types.ObjectId(id.$oid);
  if (typeof id === 'string') return new mongoose.Types.ObjectId(id);
  return id;
};

// ✅ Function to generate a unique slug using `category-productname`
const generateUniqueSlug = async (category, productName, details = []) => {
    if (!category || !productName) {
      throw new Error('Category and product name are required for slug generation');
    }
  
    // ✅ Extract brand from `details[0]` if available
    const brand = details.length > 0 && details[0].brand ? details[0].brand : '';
  
    // ✅ Remove redundant words like "flour" if the category already implies it
    const categorySlug = slugify(category, { lower: true, strict: true })
      .replace(/-+/g, '-'); // Remove extra hyphens
  
    let productSlug = slugify(productName, { lower: true, strict: true })
      .replace(/-flour$/, '') // Remove "flour" if category is "flours"
      .replace(/-+/g, '-'); // Remove extra hyphens
  
    // ✅ Append brand name if provided
    let baseSlug = brand
      ? `${categorySlug}-${slugify(brand, { lower: true, strict: true })}-${productSlug}`
      : `${categorySlug}-${productSlug}`;
  
    let slug = baseSlug;
    let exists = await Product.findOne({ slug });
  
    let counter = 1;
    while (exists) {
      slug = `${baseSlug}-${counter}`;
      exists = await Product.findOne({ slug });
      counter++;
    }
  
    return slug;
  };

const importData = async () => {
  try {
    console.log('⏳ Deleting existing data...');
    // await Order.deleteMany();
    await Product.deleteMany();
    // await User.deleteMany();

    

    // ✅ Convert `_id`, ensure `description`, and generate unique `slug`
    const sampleProducts = [];

    console.log('⏳ Processing products...');
    for (let product of products) {
      let uniqueSlug = await generateUniqueSlug(product.category, product.name);

      let newProduct = {
        ...product,
        _id: convertObjectId(product._id),
        slug: uniqueSlug, // ✅ Unique slug using `category-productname`
        details: product.details.map((detail) => ({
          ...detail,
          _id: convertObjectId(detail._id),
          description: detail.description && detail.description.trim() !== "" ? detail.description : "No description available",
          images: detail.images.map((img) => ({
            ...img,
            _id: convertObjectId(img._id),
          })),
          financials: detail.financials.map((fin) => ({
            ...fin,
            _id: convertObjectId(fin._id),
          })),
        })),
      };

      sampleProducts.push(newProduct);
    }

    console.log('✅ Sample Products Prepared:', JSON.stringify(sampleProducts, null, 2));

    console.log('⏳ Inserting products...');
    await Product.insertMany(sampleProducts);

    console.log('✅ Data Imported Successfully!'.green.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ Error: ${error.message}`.red.inverse);
    process.exit(1);
  }
};

const destroyData = async () => {
  try {
    console.log('⏳ Deleting all data...');
    await Order.deleteMany();
    await Product.deleteMany();
    await User.deleteMany();
    console.log('❌ Data Destroyed Successfully!'.red.inverse);
    process.exit();
  } catch (error) {
    console.error(`❌ Error: ${error.message}`.red.inverse);
    process.exit(1);
  }
};

// Check CLI argument and run correct function
if (process.argv[2] === '-d') {
  destroyData();
} else {
  importData();
}
