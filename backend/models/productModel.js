import mongoose from 'mongoose';
import slugify from 'slugify';

// Define a schema for the financial details
const financialSchema = new mongoose.Schema({
  price: { type: Number, required: true },
  dprice: { type: Number, required: true },
  Discount: { type: Number, required: true },
  quantity: { type: Number, required: true },
  countInStock: { type: Number, required: true },
  rating: { type: Number },
  numReviews: { type: Number },
  units: { type: String, required: true }, 
  barcode: { type: [String], default: [] },
});

// Define a schema for the image details
const imageSchema = new mongoose.Schema({
  image: { type: String, required: true },
});

// Define a schema for the product details
const productDetailSchema = new mongoose.Schema({
  brand: { type: String, required: true },
  description: { type: String, required: true },
  rating: { type: Number },
  numReviews: { type: Number },
  images: [imageSchema], // Array of images
  financials: [financialSchema], // Array of financial details
});

// Define the main product schema
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, unique: true }, 
  category: { type: String, required: true },
  rating: { type: Number },
  numReviews: { type: Number },
  details: [productDetailSchema], // Array of product details
});
// Auto-generate slug from name
productSchema.pre('save', function (next) {
  if (this.name && !this.slug) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});
// Create a Mongoose model
const Product = mongoose.model('Product', productSchema);

export default Product;


