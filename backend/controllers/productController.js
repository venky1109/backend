import asyncHandler from '../middleware/asyncHandler.js';
import Product from '../models/productModel.js';
import { assignFinancialMkIds } from '../utils/financialMkid.js';
import mongoose from 'mongoose';

const findMatchingFinancialByBarcode = (product, barcode) => {
  if (!barcode) return null;
  const barcodeToFind = String(barcode);

  for (const detail of product.details || []) {
    const financial = detail.financials?.find((item) =>
      (item.barcode || []).some((code) => String(code) === barcodeToFind)
    );

    if (financial) {
      return { detail, financial };
    }
  }

  return null;
};

const withCatalogBarcodeIdAsMkid = (product) => {
  const payload = product?.toObject ? product.toObject() : product;

  return {
    ...payload,
    details: (payload.details || []).map((detail) => ({
      ...detail,
      financials: (detail.financials || []).map((financial) => ({
        ...financial,
        mkid: financial.catalogProductBarcodeId ?? financial.mkid,
      })),
    })),
  };
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const firstDetailImage = (details = []) => {
  for (const detail of details || []) {
    const image = detail.images?.[0]?.image;
    if (image) return image;
  }

  return null;
};

const getProductImageUrl = async (product, match = null) => {
  const matchedImage = match?.detail?.images?.[0]?.image;
  if (matchedImage) return matchedImage;

  const directImage = firstDetailImage(product.details);
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

const productWithMatchMeta = async (product, match = null) => {
  const payload = withCatalogBarcodeIdAsMkid(product);
  const imageUrl = await getProductImageUrl(payload, match);

  if (!match) {
    return {
      ...payload,
      imageUrl,
    };
  }

  return {
    ...payload,
    imageUrl,
    matchedDetailId: match.detail?._id,
    matchedBrand: match.detail?.brand,
    matchedCatalogBrandId: match.detail?.catalogBrandId,
    matchedFinancialId: match.financial?._id,
    matchedCatalogProductBarcodeId: match.financial?.catalogProductBarcodeId,
    matchedMkid: match.financial?.catalogProductBarcodeId ?? match.financial?.mkid,
    matchedBarcode: match.financial?.barcode || [],
    matchedQuantity: match.financial?.quantity,
    matchedUnits: match.financial?.units,
  };
};

// @desc    Fetch all products
// @route   GET /api/products
// @access  Public
const getProducts = asyncHandler(async (req, res) => {
  const pageSize = process.env.PAGINATION_LIMIT;
  const page = Number(req.query.pageNumber) || 1;

  const keyword = req.query.keyword
    ? {
        $or:[ { name: {
          $regex: req.query.keyword,
          $options: 'i',
        }} ,
        {category: { $regex: req.query.keyword, $options: 'i', }},
        {productname: { $regex: req.query.keyword, $options: 'i', }},
        {englishname: { $regex: req.query.keyword, $options: 'i', }},
        {teluguname: { $regex: req.query.keyword, $options: 'i', }},
        {hsncode: { $regex: req.query.keyword, $options: 'i', }},
        {'details.brand': {$regex:req.query.keyword,$options: 'i', }},
      ],
      }
    : {};

  await assignFinancialMkIds(Product);

  const count = await Product.countDocuments({ ...keyword });
  const products = await Product.find({ ...keyword })
    .sort({ category: 1, name: 1 })
    .limit(pageSize)
    .skip(pageSize * (page - 1));

    // console.log(products);
  res.json({
    products: products.map(withCatalogBarcodeIdAsMkid),
    page,
    pages: Math.ceil(count / pageSize),
  });

});

// @desc    Fetch all unique categories
// @route   GET /api/products/categories
// @access  Public
const getCategories = asyncHandler(async (req, res) => {
  try {
    const keyword = req.query.keyword
      ? {
          category: { $regex: req.query.keyword, $options: 'i' }
        }
      : {};
   
    // Get distinct categories based on the keyword filter
    const categories = await Product.distinct('category', keyword);
    // console.log(categories)
    if (categories.length === 0) {
      res.status(404).json({ message: 'No categories found' });
    } else {
      res.json({ categories });
    }
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch categories' });
  }
});


// Controller to fetch products by category
export const getProductsByCategory = asyncHandler(async (req, res) => {
  try {
    const category = req.params.category;
    // console.log("products req:", req.params); // Log parameters to see what's received

    const pageSize = Number(process.env.PAGINATION_LIMIT) || 10; // Default page size if not set
    const page = Number(req.query.pageNumber) || 1; // Default to page 1 if not specified

    await assignFinancialMkIds(Product);

    // Find products by category
    const products = await Product.find({ category })
      .sort({ name: 1 })
      .limit(pageSize) // Limit number of products per page
      .skip(pageSize * (page - 1)); // Skip products for previous pages

    // Calculate total count of products for pagination
    const count = await Product.countDocuments({ category });

    if (products.length === 0) {
      res.status(404).json({ message: `No products found in category: ${category}` });
    } else {
      res.json({
        products: products.map(withCatalogBarcodeIdAsMkid),
        page,
        pages: Math.ceil(count / pageSize),
      });
    }
  } catch (error) {
    console.error('Error fetching products:', error); // Log error for debugging
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});


// @desc    Fetch single product
// @route   GET /api/products/:id
// @access  Public
// const getProductById = asyncHandler(async (req, res) => {
//   // NOTE: checking for valid ObjectId to prevent CastError moved to separate
//   // middleware. See README for more info.

//   const product = await Product.findById(req.params.id);
//   if (product) {
//     return res.json(product);
//   } else {
//     // NOTE: this will run if a valid ObjectId but no product was found
//     // i.e. product may be null
//     res.status(404);
//     throw new Error('Product not found');
//   }
// });
const getProductBySlug = asyncHandler(async (req, res) => {
  // console.log("Incoming Request Params:", req.params);  // ✅ Debugging log

  // Find the product by slug instead of ID
  await assignFinancialMkIds(Product);

  const lookupValue = String(req.params.slug || '').trim();
  const barcodeToFind = lookupValue.split(',')[0];
  const catalogBarcodeId = Number(lookupValue);
  let product = null;
  let match = null;

  if (mongoose.Types.ObjectId.isValid(lookupValue)) {
    product = await Product.findById(lookupValue);
  }

  if (!product) {
    product = await Product.findOne({ slug: lookupValue });
  }

  if (!product && barcodeToFind) {
    product = await Product.findOne({
      'details.financials.barcode': { $in: [barcodeToFind] },
    });

    if (product) {
      match = findMatchingFinancialByBarcode(product, barcodeToFind);
    }
  }

  if (!product && Number.isFinite(catalogBarcodeId)) {
    product = await Product.findOne({
      'details.financials.catalogProductBarcodeId': catalogBarcodeId,
    });

    if (product) {
      for (const detail of product.details || []) {
        const financial = detail.financials?.find(
          (item) => Number(item.catalogProductBarcodeId) === catalogBarcodeId
        );

        if (financial) {
          match = { detail, financial };
          break;
        }
      }
    }
  }

  if (product) {
    // console.log("Product Found:", product);  // ✅ Log the product if found
    return res.json(await productWithMatchMeta(product, match));
  } else {
    // console.log("Product Not Found for Slug:", req.params.slug);  // ✅ Log missing slug cases
    res.status(404);
    throw new Error("Product not found");
  }
});


// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = asyncHandler(async (req, res) => {
  const {
    name = 'Sample Product',
    productname = name,
    englishname = '',
    teluguname = '',
    hsncode = '',
    gst = 0,
    category = 'Sample',
  } = req.body;

  const product = new Product({
    name,
    productname,
    englishname,
    teluguname,
    hsncode,
    gst,
    category,
    "details": [
      {
        "brand": "TestBrand1",
        "description": "Test description 1",
        "images": [
        //   { "image": "/images/pepper.jpg" }
        ],
        "financials": [
          {
            "price": 0.00,
            "dprice": 0.00,
            "Discount": 0,
            "quantity": 0,
            "countInStock": 0,
            "units": "unit"
          },
        ]
      },
    ]
  });

  const createdProduct = await product.save();
  res.status(201).json(createdProduct);
});

// @desc    Create a product
// @route   POST /api/products/:productId/details
// @access  Private/Admin
const createProductDetail = asyncHandler(async (req, res) => {
  const productId = req.params.id;
  const product = await Product.findById(productId);

  if (product) {

    const newDetail = {
      "brand": "TestBrand1",
      "description": "Test description 1",
      "images": [
        // { "image": "" }
      ],
      "financials": [
        {
          "price": 0.00,
          "dprice": 0.00,
          "Discount": 0,
          "quantity": 0,
          "countInStock": 0,
          "units": "unit"
        },
      ]
    };
  

    product.details.push(newDetail);  // Push the new detail to the details array

    await product.save();  // Save the updated product

    res.status(201).json(newDetail);
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});




// @desc    Create a product
// @route   POST /api/products/:productId/details
// @access  Private/Admin
const createFinancialDetail = asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const detailID =req.params.id;
  const product = await Product.findById(productId);
  const detail = product.details.find((detail) => detail._id.toString() === detailID);

  if (detail) {
    
    const newFinancial = {
  
     
          "price": 0.00,
          "dprice": 0.00,
          "Discount": 0,
          "quantity": 0,
          "countInStock": 0,
          "units": "unit"
        
      
    };
  

    detail.financials.push(newFinancial);  // Push the new detail to the details array

    await product.save();  // Save the updated product

    res.status(201).json(newFinancial);
  } else {
    res.status(404);
    throw new Error('Detail not found');
  }
});

const getFinancialDetails = async (req, res) => {
  const { productId, id: detailId, financialId } = req.params; // Destructure params

  try {
    await assignFinancialMkIds(Product);

    // Find the product by productId
    const product = await Product.findById(productId);

    if (product) {
      // Find the specific detail by detailId
      const detail = product.details.id(detailId);

      if (detail) {
        // Find the specific financial detail by financialId
        const financialDetail = detail.financials.id(financialId);

        if (financialDetail) {
          res.status(200).json(financialDetail); // Send the financial detail as a response
        } else {
          res.status(404).json({ message: 'Financial detail not found' });
        }
      } else {
        res.status(404).json({ message: 'Product detail not found' });
      }
    } else {
      res.status(404).json({ message: 'Product not found' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};
const getBatchFinancialDetails = async (req, res) => {
  try {
    // Log the incoming request body for debugging
    // console.log('Request body:', req.body);

    // Expecting an array of items from the request body
    const { items } = req.body;

    // Validate that items exist and is an array
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ message: 'Invalid request, items array is required' });
    }

    await assignFinancialMkIds(Product);

    // Fetch the financial details for the items in the batch
    const financialDetails = await Promise.all(
      items.map(async (item) => {
        try {
          // Fetch the product by ID
          const product = await Product.findById(item.productId);
          if (!product) {
            return { error: `Product ${item.productId} not found` };
          }

          // Find the specific detail by detailId
          const detail = product.details.id(item.detailId);
          if (!detail) {
            return { error: `Detail ${item.detailId} not found` };
          }

          // Find the specific financial record by financialId
          const financial = detail.financials.id(item.financialId);
          if (!financial) {
            return { error: `Financial ${item.financialId} not found` };
          }

          // Return the financial details
          return {
            productId: item.productId,
            detailId: item.detailId,
            financialId: item.financialId,
            mkid: financial.catalogProductBarcodeId ?? financial.mkid,
            price: financial.price,
            dprice: financial.dprice,
            discount:  financial.Discount, // Handle both possible naming conventions
          };
        } catch (err) {
          // Handle any unexpected errors during the fetch process
          return { error: `Error fetching data for productId: ${item.productId}`, details: err.message };
        }
      })
    );

    // Respond with the fetched financial details
    res.json(financialDetails);
  } catch (error) {
    // General error handler for the entire operation
    console.error('Server Error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};


// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = asyncHandler(async (req, res) => {
  const {
    name,
    productname,
    englishname,
    teluguname,
    hsncode,
    gst,
    price,
    description,
    image,
    brand,
    category,
    countInStock,
  } =
    req.body;

  const product = await Product.findById(req.params.id);

  if (product) {
    product.name = name ?? product.name;
    product.productname = productname ?? product.productname ?? product.name;
    product.englishname = englishname ?? product.englishname;
    product.teluguname = teluguname ?? product.teluguname;
    product.hsncode = hsncode ?? product.hsncode;
    product.gst = gst ?? product.gst;
    product.price = price ?? product.price;
    product.description = description ?? product.description;
    product.image = image ?? product.image;
    product.brand = brand ?? product.brand;
    product.category = category ?? product.category;
    product.countInStock = countInStock ?? product.countInStock;

    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});

// @desc    Delete a product
// @route   DELETE /api/products/:id
// @access  Private/Admin
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (product) {
    await Product.deleteOne({ _id: product._id });
    res.json({ message: 'Product removed' });
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});


// Example: app.delete('/api/products/:productId/details/:detailId', deleteProductDetail);
// @desc    Delete a product
// @route   DELETE /api/products/:productId/details/:detailId
// @access  Private/Admin

const deleteProductDetail = asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const detailId = req.params.id;

  // console.log(productId+'productId'+detailId)
  const product = await Product.findById(productId);

  if (product) {
    const detailIndex = product.details.findIndex((detail) => detail._id.toString() === detailId);

    if (detailIndex !== -1) {
      product.details.splice(detailIndex, 1);
      await product.save();
      res.json({ message: 'Product detail removed' });
    } else {
      res.status(404);
      throw new Error('Product detail not found');
    }
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});


const updateProductDetail = asyncHandler(async (req, res) => {
  const productId = req.params.productId;
  const detailId = req.params.id;
  const {
    name,
    productname,
    englishname,
    teluguname,
    hsncode,
    gst,
    brand,
    category,
    discount,
    price,
    quantity,
    image,
    manualQuantity,
  } = req.body; // Adjust these based on your detail structure

  try {
    const product = await Product.findById(productId);
   
    if (product) {
      const detail = product.details.find((detail) => detail._id.toString() === detailId);
      product.name = name ?? product.name;
      product.productname = productname ?? product.productname ?? product.name;
      product.englishname = englishname ?? product.englishname;
      product.teluguname = teluguname ?? product.teluguname;
      product.hsncode = hsncode ?? product.hsncode;
      product.gst = gst ?? product.gst;
      product.category = category ?? product.category;
    //   console.log('category'+category);
      if (detail) {
        // Update the detail properties
       
        detail.brand = brand;
        if (image) {
          detail.images.push({ image });
        }
        
        
        let financial;

if ( manualQuantity !== null ) {
  financial = detail.financials[detail.financials.length-1]; // Access the first financial detail
  financial.quantity = manualQuantity;
  // financial = detail.financials.find(
  //   (fin) => fin.quantity.toString() === manualQuantity.toString()
  // );
  // console.log('detail.financials '+detail.financials+'manualQuantity '+manualQuantity +' req.params'+ productId +'-'+detailId)
      
} else {
  financial = detail.financials.find(
    (fin) => fin.quantity.toString() === quantity.toString()
  );
}
        financial.price = price;
          // financial.quantity = quantity;
        financial.Discount =discount;
        financial.dprice=(price - (price * (discount / 100))).toFixed(2);
        
        // console.log('detail.financials '+detail.financials+'manualQuantity '+manualQuantity +' req.params'+ productId +'-'+detailId)
      
        await product.save();
        res.json({ message: 'Product detail updated' });
      } else {
        res.status(404);
        throw new Error('Product detail not found');
      }
    } else {
      res.status(404);
      throw new Error('Product not found');
    }
  } catch (error) {
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
});



// @desc    Create new review
// @route   POST /api/products/:id/reviews
// @access  Private
const createProductReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;

  const product = await Product.findById(req.params.id);

  if (product) {
    const alreadyReviewed = product.reviews.find(
      (r) => r.user.toString() === req.user._id.toString()
    );

    if (alreadyReviewed) {
      res.status(400);
      throw new Error('Product already reviewed');
    }

    const review = {
      name: req.user.name,
      rating: Number(rating),
      comment,
      user: req.user._id,
    };

    product.reviews.push(review);

    product.numReviews = product.reviews.length;

    product.rating =
      product.reviews.reduce((acc, item) => item.rating + acc, 0) /
      product.reviews.length;

    await product.save();
    res.status(201).json({ message: 'Review added' });
  } else {
    res.status(404);
    throw new Error('Product not found');
  }
});

// @desc    Get top rated products
// @route   GET /api/products/top
// @access  Public
const getTopProducts = asyncHandler(async (req, res) => {
  await assignFinancialMkIds(Product);

  const products = await Product.find({}).sort({ rating: -1 }).limit(3);

  res.json(products.map(withCatalogBarcodeIdAsMkid));
});

// const updateStockById = asyncHandler(async (req, res) => {
//   const { brandID, financialID, newQuantity } = req.body;
// console.log('updateStockById'+JSON.stringify(req.body))
// // console.log(req.params.productID)
// // console.log(JSON.stringify(req.params))
// console.log(req.params)


//   if (!brandID || !financialID || typeof newQuantity !== 'number') {
//     res.status(400);
//     throw new Error('brandID, financialID, and valid newQuantity are required');
//   }

//   const product = await Product.findById(req.params.id);
//   if (!product) {
//     res.status(404);
//     throw new Error('Product not found');
//   }

//   const brand = product.details.find((d) => d._id.toString() === brandID);
//   if (!brand) {
//     res.status(404);
//     throw new Error(`Brand not found: ${brandID}`);
//   }

//   const financial = brand.financials.find((f) => f._id.toString() === financialID);
//   if (!financial) {
//     res.status(404);
//     throw new Error(`Financial record not found: ${financialID}`);
//   }

//   financial.countInStock = newQuantity;

//   await product.save();
//   res.status(200).json({
//     message: 'Stock updated',
//     productID: req.params.id,
//     brandID,
//     financialID,
//     newQuantity,
//   });
// });

const updateStockById = asyncHandler(async (req, res) => {
  const {
    brandID,
    financialID,
    newQuantity,
    countInStock,
    price,
    MRP,
    mrp,
    dprice,
    sellingPrice,
    salePrice,
    discountedPrice,
    discountPrice,
    discount,
    Discount,
    quantity,
    packQuantity,
    weight,
    units,
    unit,
    barcode,
    name,
    productName,
    productname,
    englishname,
    teluguname,
    hsncode,
    gst,
    gstRate,
    category,
    brand,
    image,
    imageUrl,
  } = req.body;
  const { id: productId } = req.params;

  // console.log('🛠️ Updating stock for:', { productId, brandID, financialID, newQuantity });

  if (!brandID || !financialID) {
    res.status(400);
    throw new Error('brandID and financialID are required');
  }

  if (
    !mongoose.Types.ObjectId.isValid(productId) ||
    !mongoose.Types.ObjectId.isValid(brandID) ||
    !mongoose.Types.ObjectId.isValid(financialID)
  ) {
    res.status(400);
    throw new Error('Valid productID, brandID, and financialID are required');
  }

  const setFields = {};
  const finalCountInStock = newQuantity ?? countInStock;
  const finalPrice = price ?? MRP ?? mrp;
  const finalDprice = dprice ?? sellingPrice ?? salePrice ?? discountedPrice ?? discountPrice;
  const finalDiscount = Discount ?? discount;
  const finalQuantity = quantity ?? packQuantity ?? weight;
  const finalUnits = units ?? unit;
  const finalGst = gst ?? gstRate;
  const finalName = name ?? productName;
  const finalProductName =
    productname ??
    (englishname && teluguname ? `${englishname}(${teluguname})` : undefined) ??
    finalName;
  const toFiniteNumber = (value, fieldName) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      res.status(400);
      throw new Error(`${fieldName} must be a number`);
    }
    return parsed;
  };

  if (finalCountInStock !== undefined) {
    setFields['details.$[brand].financials.$[financial].countInStock'] = toFiniteNumber(
      finalCountInStock,
      'newQuantity/countInStock'
    );
  }

  if (finalPrice !== undefined) {
    setFields['details.$[brand].financials.$[financial].price'] = toFiniteNumber(finalPrice, 'price');
  }

  if (finalDprice !== undefined) {
    setFields['details.$[brand].financials.$[financial].dprice'] = toFiniteNumber(finalDprice, 'dprice');
  }

  if (finalDiscount !== undefined) {
    setFields['details.$[brand].financials.$[financial].Discount'] = toFiniteNumber(
      finalDiscount,
      'discount/Discount'
    );
  }

  if (finalQuantity !== undefined) {
    setFields['details.$[brand].financials.$[financial].quantity'] = toFiniteNumber(finalQuantity, 'quantity');
  }

  if (finalUnits !== undefined) {
    setFields['details.$[brand].financials.$[financial].units'] = finalUnits;
  }

  if (barcode !== undefined) {
    setFields['details.$[brand].financials.$[financial].barcode'] = Array.isArray(barcode)
      ? barcode
      : [barcode];
  }

  if (finalName !== undefined) setFields.name = finalName;
  if (finalProductName !== undefined) setFields.productname = finalProductName;
  if (englishname !== undefined) setFields.englishname = englishname;
  if (teluguname !== undefined) setFields.teluguname = teluguname;
  if (hsncode !== undefined) setFields.hsncode = hsncode;
  if (finalGst !== undefined) setFields.gst = toFiniteNumber(finalGst, 'gst/gstRate');
  if (category !== undefined) setFields.category = category;
  if (brand !== undefined) setFields['details.$[brand].brand'] = brand;

  const finalImage = imageUrl ?? image;
  if (finalImage !== undefined) {
    setFields['details.$[brand].images'] = finalImage ? [{ image: finalImage }] : [];
  }

  if (Object.keys(setFields).length === 0) {
    res.status(400);
    throw new Error('No valid financial fields provided for update');
  }

  const product = await Product.findOneAndUpdate(
    {
      _id: productId,
      'details._id': brandID,
      'details.financials._id': financialID,
    },
    {
      $set: setFields,
    },
    {
      new: true,
      runValidators: true,
      arrayFilters: [
        { 'brand._id': new mongoose.Types.ObjectId(brandID) },
        { 'financial._id': new mongoose.Types.ObjectId(financialID) },
      ],
    }
  );

  if (!product) {
    res.status(404);
    throw new Error('Product, brand, or financial record not found');
  }

  const updatedBrand = product.details.id(brandID);
  const financial = updatedBrand?.financials.id(financialID);

  res.status(200).json({
    message: 'Stock updated successfully',
    productID: product._id,
    brandID,
    financialID,
    newQuantity: finalCountInStock,
    countInStock: financial?.countInStock,
    financial,
  });
});


export {
  getProducts,
  getCategories,
  getProductBySlug,
  createProduct,
  createProductDetail,
  createFinancialDetail,
  getFinancialDetails,
  getBatchFinancialDetails,
  updateProduct,
  deleteProduct,
  deleteProductDetail,
  updateProductDetail,
  createProductReview,
  getTopProducts,
  updateStockById,
};
