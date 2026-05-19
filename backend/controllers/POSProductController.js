
import Product from '../models/productModel.js';
import mongoose from 'mongoose';
import { assignFinancialMkIds, findFinancialByMkid } from '../utils/financialMkid.js';

export const createPOSProductFromCatalog = async (req, res) => {
  try {
    const { productId, brand, description, image, financial } = req.body;

    const catalogProduct = await Product.findById(productId);
    if (!catalogProduct) return res.status(404).json({ error: 'Catalog product not found' });

    const newProduct = new Product({
      _id: new mongoose.Types.ObjectId(),
      name: catalogProduct.name,
      slug: `${catalogProduct.slug}-${Date.now()}`, // unique slug
      category: catalogProduct.category,
      details: [
        {
          _id: new mongoose.Types.ObjectId(),
          brand,
          description,
          images: image ? [{ _id: new mongoose.Types.ObjectId(), image }] : [],
          financials: [
            {
              _id: new mongoose.Types.ObjectId(),
              ...financial
            }
          ]
        }
      ]
    });

    await newProduct.save();
    res.status(201).json({ message: 'POS Product created from catalog', product: newProduct });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create POS product', details: err.message });
  }
};


// @desc Add financial variant to existing POS product
export const addFinancialToPOSProduct = async (req, res) => {
  try {
    const { productId, detailId, financial } = req.body;

    if (!productId || !detailId || !financial)
      return res.status(400).json({ error: 'Missing required fields' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const detail = product.details.id(detailId);
    if (!detail) return res.status(404).json({ error: 'Detail not found' });

    const newFinancial = {
      _id: new mongoose.Types.ObjectId(),
      ...financial,
    };

    detail.financials.push(newFinancial);
    await product.save();

    res.status(200).json({
      message: 'Financial variant added',
      financial: newFinancial,
      detailId: detail._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add financial variant' });
  }
};

// @desc Update financial variant in POS product
export const updatePOSProductFinancial = async (req, res) => {
  try {
    const { productId, detailId, financialId, updateFields } = req.body;
    // console.log('123'+JSON.stringify(req.body))

    if (!productId || !detailId || !financialId || !updateFields)
      return res.status(400).json({ error: 'Missing required fields' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const detail = product.details.id(detailId);
    if (!detail) return res.status(404).json({ error: 'Detail not found' });

    const financial = detail.financials.id(financialId);
    if (!financial) return res.status(404).json({ error: 'Financial variant not found' });

    // console.log(financial)

    Object.assign(financial, updateFields);
    await product.save();

    res.status(200).json({
      message: 'Financial updated',
      financial,
      detailId: detail._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update financial' });
  }
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const firstDetailImage = (details = []) => {
  for (const item of details || []) {
    const image = item.images?.[0]?.image;
    if (image) return image;
  }

  return null;
};

const findFallbackImageUrl = async (product, detail) => {
  const directImage = detail?.images?.[0]?.image || firstDetailImage(product.details);
  if (directImage) return directImage;

  const orFilters = [];

  if (product.catalogProductId) {
    orFilters.push({ catalogProductId: product.catalogProductId });
  }

  for (const value of [product.englishname, product.productname, product.name]) {
    if (value) {
      orFilters.push({ name: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });
      orFilters.push({ productname: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });
      orFilters.push({ englishname: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });
    }
  }

  if (!orFilters.length) return null;

  const imageProduct = await Product.findOne({
    _id: { $ne: product._id },
    'details.images.0': { $exists: true },
    $or: orFilters,
  }).select('details.images');

  return imageProduct ? firstDetailImage(imageProduct.details) : null;
};

const buildPOSProductSearchResponse = async ({ product, detail, financial }) => {
  const price = Number(financial.price || 0);
  const dprice = Number(financial.dprice || 0);
  const imageUrl = await findFallbackImageUrl(product, detail);

  return {
    id: product._id,
    catalogProductId: product.catalogProductId,
    productName: product.name,
    productname: product.productname || product.name,
    englishname: product.englishname || '',
    teluguname: product.teluguname || '',
    hsncode: product.hsncode || '',
    gst: product.gst ?? 0,
    category: product.category,
    brand: detail.brand,
    catalogBrandId: detail.catalogBrandId,
    brandId: detail._id,
    financialId: financial._id,
    catalogProductBarcodeId: financial.catalogProductBarcodeId,
    mkid: financial.mkid,
    MRP: financial.price,
    dprice: financial.dprice,
    quantity: financial.quantity,
    countInStock: financial.countInStock,
    units: financial.units,
    image: imageUrl,
    imageUrl,
    catalogQuantity: financial.quantity,
    discount: price > 0 ? Math.round(((price - dprice) / price) * 100) : 0,
    qty: 1,
    barcode: financial.barcode,
  };
};

// @desc Get product by barcode
export const getPOSProductByBarcode = async (req, res) => {
  try {
    // const { barcode } = req.params;
    // console.log('123 ' + barcode);

    // // Use $in operator to check if barcode exists in the array of barcodes
    // const product = await Product.findOne({
    //   "details.financials.barcode": { $in: [barcode] }  // Check if the barcode is in the array
    // });
    // // console.log('123', product);

    const { barcode } = req.params;
    // console.log('123 ' + barcode);

    await assignFinancialMkIds(Product);

    // Assuming barcode is a string with multiple barcodes separated by commas
    const barcodesArray = barcode.split(',');
    const barcodeToFind = barcodesArray[0];

    // Check if the first barcode in the array exists in the product's financial details
    const product = await Product.findOne({
      "details.financials.barcode": { $in: [barcodeToFind] }  // Check if the first barcode is in the array
    });

    // console.log('Found product:', product);

    if (!product) {
      return res.status(404).json({ error: "Product with barcode not found" });
    }

    // Find the detail with the matching barcode
    const detail = product.details.find((d) =>
      d.financials.some((f) => f.barcode.includes(barcodeToFind))  // Check if barcode exists in the array
    );

    if (!detail) {
      return res.status(404).json({ error: "Matching detail not found" });
    }

    // Find the financial entry with the matching barcode
    const financial = detail.financials.find((f) => f.barcode.includes(barcodeToFind));
    const response = await buildPOSProductSearchResponse({ product, detail, financial });

    return res.status(200).json(response);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch product by barcode" });
  }
};

// @desc Get product by MKID typed by cashier
export const getPOSProductByMkid = async (req, res) => {
  try {
    const found = await findFinancialByMkid(Product, req.params.mkid);

    if (!found) {
      return res.status(404).json({ error: "Product with MKID not found" });
    }

    const { product, detail, financial } = found;
    const response = await buildPOSProductSearchResponse({ product, detail, financial });

    return res.status(200).json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch product by MKID" });
  }
};

