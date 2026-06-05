
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

const sameText = (left, right) =>
  String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

export const upsertPOSProductFinancialFromAssigner = async (req, res) => {
  try {
    const {
      productId,
      detailId,
      financialId,
      productData = {},
      detailData = {},
      financialData = {},
    } = req.body;

    if (!financialData?.mk_barcode) {
      return res.status(400).json({ error: 'MK barcode is required' });
    }

    let product = productId ? await Product.findById(productId) : null;

    if (!product) {
      product = await Product.findOne({ 'details.financials.mk_barcode': String(financialData.mk_barcode) });
    }

    if (!product && productData.catalogProductId && productData.catalogCategoryId) {
      product = await Product.findOne({
        catalogProductId: Number(productData.catalogProductId),
        catalogCategoryId: Number(productData.catalogCategoryId),
      });
    }

    if (!product && productData.name && productData.category) {
      const candidates = await Product.find({
        $or: [
          { name: productData.name },
          { productname: productData.name },
          { englishname: productData.name },
        ],
      }).limit(25);
      product = candidates.find((item) => sameText(item.category, productData.category)) || null;
    }

    if (!product) {
      product = new Product({
        _id: new mongoose.Types.ObjectId(),
        catalogProductId: productData.catalogProductId ? Number(productData.catalogProductId) : undefined,
        catalogCategoryId: productData.catalogCategoryId ? Number(productData.catalogCategoryId) : undefined,
        mongoCategoryId: productData.mongoCategoryId || new mongoose.Types.ObjectId().toString(),
        name: productData.name || productData.productname || productData.englishname,
        productname: productData.productname || productData.name || productData.englishname,
        englishname: productData.englishname || productData.name || '',
        teluguname: productData.teluguname || '',
        hsncode: productData.hsncode || '',
        gst: Number(productData.gst || 0),
        category: productData.category || 'Migration',
        details: [],
      });
    } else {
      product.catalogProductId = productData.catalogProductId
        ? Number(productData.catalogProductId)
        : product.catalogProductId;
      product.catalogCategoryId = productData.catalogCategoryId
        ? Number(productData.catalogCategoryId)
        : product.catalogCategoryId;
      product.name = productData.name || product.name;
      product.productname = productData.productname || product.productname || product.name;
      product.englishname = productData.englishname || product.englishname || product.name;
      product.teluguname = productData.teluguname || product.teluguname;
      product.hsncode = productData.hsncode || product.hsncode;
      product.gst = productData.gst !== undefined && productData.gst !== null ? Number(productData.gst) : product.gst;
      product.category = productData.category || product.category;
    }

    let detail =
      (detailId ? product.details.id(detailId) : null) ||
      product.details.find((item) =>
        (detailData.catalogBrandId && Number(item.catalogBrandId) === Number(detailData.catalogBrandId)) ||
        sameText(item.brand, detailData.brand)
      );

    if (!detail) {
      product.details.push({
        _id: new mongoose.Types.ObjectId(),
        catalogBrandId: detailData.catalogBrandId ? Number(detailData.catalogBrandId) : undefined,
        brand: detailData.brand || 'Migration',
        description: detailData.description || 'Created from barcode assigner',
        images: detailData.image ? [{ image: detailData.image }] : [],
        financials: [],
      });
      detail = product.details[product.details.length - 1];
    } else {
      detail.catalogBrandId = detailData.catalogBrandId
        ? Number(detailData.catalogBrandId)
        : detail.catalogBrandId;
      detail.brand = detailData.brand || detail.brand;
      detail.description = detailData.description || detail.description || 'Created from barcode assigner';
      if (detailData.image) {
        if (detail.images?.length) {
          detail.images[0].image = detailData.image;
          detail.images = [detail.images[0]];
        } else {
          detail.images = [{ image: detailData.image }];
        }
      }
    }

    let financial =
      (financialId ? detail.financials.id(financialId) : null) ||
      detail.financials.find((item) => String(item.mk_barcode || '') === String(financialData.mk_barcode));

    const cleanBarcode = Array.isArray(financialData.barcode)
      ? financialData.barcode.filter(Boolean).map(String)
      : financialData.barcode
        ? [String(financialData.barcode)]
        : [];

    const nextFinancial = {
      catalogProductBarcodeId: financialData.catalogProductBarcodeId,
      product_barcode_id: financialData.product_barcode_id || financialData.catalogProductBarcodeId,
      mkid: financialData.catalogProductBarcodeId,
      mk_barcode: String(financialData.mk_barcode),
      price: Number(financialData.price || 0),
      dprice: Number(financialData.dprice || 0),
      Discount: Number(financialData.Discount ?? financialData.discount ?? 0),
      quantity: Number(financialData.quantity || 0),
      countInStock: Number(financialData.countInStock || 0),
      units: financialData.units || 'QTY',
      barcode: cleanBarcode,
      updatedAt: new Date(),
    };

    if (financial) {
      Object.assign(financial, nextFinancial);
      financial.createdAt = financial.createdAt || financialData.createdAt || new Date();
    } else {
      detail.financials.push({
        _id: new mongoose.Types.ObjectId(),
        ...nextFinancial,
        createdAt: financialData.createdAt || new Date(),
      });
      financial = detail.financials[detail.financials.length - 1];
    }

    await product.save();

    res.status(200).json({
      message: financialId ? 'Financial updated' : 'Financial assigned',
      product,
      detailId: detail._id,
      financial,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save barcode assignment', details: err.message });
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
    mkid: financial.catalogProductBarcodeId,
    productBarcodeId: financial.catalogProductBarcodeId,
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

const findFinancialByCatalogProductBarcodeId = async (catalogProductBarcodeId) => {
  const numericBarcodeId = Number(catalogProductBarcodeId);
  if (!Number.isInteger(numericBarcodeId) || numericBarcodeId < 1) return null;

  const product = await Product.findOne({
    'details.financials.catalogProductBarcodeId': numericBarcodeId,
  });

  if (!product) return null;

  for (const detail of product.details || []) {
    const financial = detail.financials?.find(
      (item) => Number(item.catalogProductBarcodeId) === numericBarcodeId
    );

    if (financial) {
      return { product, detail, financial };
    }
  }

  return null;
};

// @desc Get product by catalog product barcode ID typed by cashier
export const getPOSProductByCatalogProductBarcodeId = async (req, res) => {
  try {
    const catalogProductBarcodeId =
      req.params.catalogProductBarcodeId || req.params.mkid;
    const found = await findFinancialByCatalogProductBarcodeId(catalogProductBarcodeId);

    if (!found) {
      return res.status(404).json({ error: "Product with catalogProductBarcodeId not found" });
    }

    const { product, detail, financial } = found;
    const response = await buildPOSProductSearchResponse({ product, detail, financial });

    return res.status(200).json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch product by catalogProductBarcodeId" });
  }
};

