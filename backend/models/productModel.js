import mongoose from 'mongoose';
import slugify from 'slugify';

// Define a schema for the financial details
const financialSchema = new mongoose.Schema({
  catalogProductBarcodeId: { type: Number, index: true },
  product_barcode_id: { type: Number, index: true },
  mkid: { type: Number, index: true },
  mk_barcode: { type: String, index: true },
  price: { type: Number, required: true },
  dprice: { type: Number, required: true },
  Discount: { type: Number, required: true },
  quantity: { type: Number, required: true },
  countInStock: { type: Number, required: true },
  createdAt: { type: Date },
  updatedAt: { type: Date },
  rating: { type: Number },
  numReviews: { type: Number },
  units: { type: String, required: true }, 
  barcode: { type: [String], default: [] },
});

financialSchema.set('toJSON', {
  transform: (_doc, ret) => {
    if (ret.catalogProductBarcodeId !== undefined && ret.catalogProductBarcodeId !== null) {
      ret.mkid = ret.catalogProductBarcodeId;
    }
    return ret;
  },
});

financialSchema.set('toObject', {
  transform: (_doc, ret) => {
    if (ret.catalogProductBarcodeId !== undefined && ret.catalogProductBarcodeId !== null) {
      ret.mkid = ret.catalogProductBarcodeId;
    }
    return ret;
  },
});

// Define a schema for the image details
const imageSchema = new mongoose.Schema({
  image: { type: String, required: true },
});

// Define a schema for the product details
const productDetailSchema = new mongoose.Schema({
  catalogBrandId: { type: Number, index: true },
  brand: { type: String, required: true },
  description: { type: String, required: true },
  rating: { type: Number },
  numReviews: { type: Number },
  images: [imageSchema], // Array of images
  financials: [financialSchema], // Array of financial details
});

// Define the main product schema
const productSchema = new mongoose.Schema({
  catalogProductId: { type: Number, index: true },
  catalogCategoryId: { type: Number, index: true },
  mongoCategoryId: { type: String, index: true },
  name: { type: String, required: true },
  productname: { type: String, index: true },
  englishname: { type: String, index: true },
  teluguname: { type: String, index: true },
  hsncode: { type: String, index: true },
  gst: { type: Number, default: 0 },
  slug: { type: String, unique: true }, 
  category: { type: String, required: true },
  rating: { type: Number },
  numReviews: { type: Number },
  details: [productDetailSchema], // Array of product details
});
// Auto-generate slug from name
productSchema.pre('save', function (next) {
  if (!this.name && this.productname) {
    this.name = this.productname;
  }

  if (!this.productname && this.name) {
    this.productname = this.name;
  }

  if (this.name) {
    const baseSlug = this.catalogProductId
      ? `${this.name}-${this.catalogProductId}`
      : this.name;
    this.slug = slugify(baseSlug, { lower: true, strict: true });
  }
  next();
});
// Create a Mongoose model
const Product = mongoose.model('Product', productSchema);

export default Product;


