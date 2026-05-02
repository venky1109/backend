
import Product from '../models/productModel.js';
import mongoose from 'mongoose';

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
    console.log('123'+JSON.stringify(req.body))

    if (!productId || !detailId || !financialId || !updateFields)
      return res.status(400).json({ error: 'Missing required fields' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const detail = product.details.id(detailId);
    if (!detail) return res.status(404).json({ error: 'Detail not found' });

    const financial = detail.financials.id(financialId);
    if (!financial) return res.status(404).json({ error: 'Financial variant not found' });

    console.log(financial)

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

// Assuming barcode is a string with multiple barcodes separated by commas
const barcodesArray = barcode.split(',');

// Check if the first barcode in the array exists in the product's financial details
const product = await Product.findOne({
  "details.financials.barcode": { $in: [barcodesArray[0]] }  // Check if the first barcode is in the array
});

console.log('Found product:', product);

    if (!product) {
      return res.status(404).json({ error: "Product with barcode not found" });
    }

    // Find the detail with the matching barcode
    const detail = product.details.find((d) =>
      d.financials.some((f) => f.barcode.includes([barcodesArray[0]]))  // Check if barcode exists in the array
    );

    if (!detail) {
      return res.status(404).json({ error: "Matching detail not found" });
    }

    // Find the financial entry with the matching barcode
    const financial = detail.financials.find((f) => f.barcode.includes([barcodesArray[0]]));

    const response = {
      id: product._id,
      productName: product.name,
      category: product.category,
      brand: detail.brand,
      brandId: detail._id,
      financialId: financial._id,
      MRP: financial.price,
      dprice: financial.dprice,
      quantity: financial.quantity,
      countInStock: financial.countInStock,
      units: financial.units,
      image: detail.images?.[0]?.image || null,
      catalogQuantity: financial.quantity,
      discount: Math.round(((financial.price - financial.dprice) / financial.price) * 100),
      qty: 1,
      barcode: financial.barcode  // Return the barcode as an array
    };

    return res.status(200).json(response);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch product by barcode" });
  }
};

