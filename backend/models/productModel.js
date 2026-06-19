import mongoose from 'mongoose';
import slugify from 'slugify';

// Define a schema for the financial details
const financialSchema = new mongoose.Schema({
  // Cashier shortcode and barcode identity. The catalog linkage fields below are optional legacy duplicates.
  catalogProductBarcodeId: { type: Number, index: true },
  product_barcode_id: { type: Number, index: true },
  mkid: { type: Number, index: true },
  mk_barcode: { type: String, index: true },
  price: { type: Number, required: true },
  dprice: { type: Number, required: true },
  Discount: { type: Number, required: true },
  quantity: { type: Number, required: true },
  countInStock: { type: Number, required: true },
  mfg_date: { type: String },
  exp_date: { type: String },
  createdAt: { type: Date },
  updatedAt: { type: Date },
  rating: { type: Number },
  numReviews: { type: Number },
  units: { type: String, required: true }, 
  barcode: { type: [String], default: [] },
});

financialSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const legacyMkid = ret.catalogProductBarcodeId ?? ret.product_barcode_id;
    if ((ret.mkid === undefined || ret.mkid === null) && legacyMkid !== undefined && legacyMkid !== null) {
      ret.mkid = legacyMkid;
    }
    return ret;
  },
});

financialSchema.set('toObject', {
  transform: (_doc, ret) => {
    const legacyMkid = ret.catalogProductBarcodeId ?? ret.product_barcode_id;
    if ((ret.mkid === undefined || ret.mkid === null) && legacyMkid !== undefined && legacyMkid !== null) {
      ret.mkid = legacyMkid;
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
const makeUniqueProductSlug = async (ProductModel, baseSlug, currentId) => {
  let candidate = baseSlug;
  let serial = 1;

  while (
    await ProductModel.exists({
      slug: candidate,
      _id: { $ne: currentId },
    })
  ) {
    candidate = `${baseSlug}-${serial}`;
    serial += 1;
  }

  return candidate;
};

// Auto-generate a unique slug from name
productSchema.pre('save', async function (next) {
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
    const normalizedBaseSlug = slugify(baseSlug, { lower: true, strict: true });
    this.slug = await makeUniqueProductSlug(this.constructor, normalizedBaseSlug, this._id);
  }
  next();
});
// Create a Mongoose model
const Product = mongoose.model('Product', productSchema);

export default Product;


