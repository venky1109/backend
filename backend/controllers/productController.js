import asyncHandler from '../middleware/asyncHandler.js';
import Product from '../models/productModel.js';

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
        {'details.brand': {$regex:req.query.keyword,$options: 'i', }},
      ],
      }
    : {};

  const count = await Product.countDocuments({ ...keyword });
  const products = await Product.find({ ...keyword })
    .limit(pageSize)
    .skip(pageSize * (page - 1));

    // console.log(products);
  res.json({ products, page, pages: Math.ceil(count / pageSize) });

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

    // Find products by category
    const products = await Product.find({ category })
      .limit(pageSize) // Limit number of products per page
      .skip(pageSize * (page - 1)); // Skip products for previous pages

    // Calculate total count of products for pagination
    const count = await Product.countDocuments({ category });

    if (products.length === 0) {
      res.status(404).json({ message: `No products found in category: ${category}` });
    } else {
      res.json({ products, page, pages: Math.ceil(count / pageSize) });
    }
  } catch (error) {
    console.error('Error fetching products:', error); // Log error for debugging
    res.status(500).json({ message: 'Failed to fetch products' });
  }
});


// @desc    Fetch single product
// @route   GET /api/products/:id
// @access  Public
const getProductById = asyncHandler(async (req, res) => {
  // NOTE: checking for valid ObjectId to prevent CastError moved to separate
  // middleware. See README for more info.

  const product = await Product.findById(req.params.id);
  if (product) {
    return res.json(product);
  } else {
    // NOTE: this will run if a valid ObjectId but no product was found
    // i.e. product may be null
    res.status(404);
    throw new Error('Product not found');
  }
});

// @desc    Create a product
// @route   POST /api/products
// @access  Private/Admin
const createProduct = asyncHandler(async (req, res) => {
  const product = new Product({
    "name": "Sample Product",
    "category": "Sample",
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
            "countInStock": 0
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
          "countInStock": 0
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
          "countInStock": 0
        
      
    };
  

    detail.financials.push(newFinancial);  // Push the new detail to the details array

    await product.save();  // Save the updated product

    res.status(201).json(newFinancial);
  } else {
    res.status(404);
    throw new Error('Detail not found');
  }
});

// @desc    Update a product
// @route   PUT /api/products/:id
// @access  Private/Admin
const updateProduct = asyncHandler(async (req, res) => {
  const { name, price, description, image, brand, category, countInStock } =
    req.body;

  const product = await Product.findById(req.params.id);

  if (product) {
    product.name = name;
    product.price = price;
    product.description = description;
    product.image = image;
    product.brand = brand;
    product.category = category;
    product.countInStock = countInStock;

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
  const { name,brand,category, discount,price, quantity,image,manualQuantity } = req.body; // Adjust these based on your detail structure

  try {
    const product = await Product.findById(productId);
   
    if (product) {
      const detail = product.details.find((detail) => detail._id.toString() === detailId);
      product.name = name;
      product.category=category;
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
  const products = await Product.find({}).sort({ rating: -1 }).limit(3);

  res.json(products);
});

export {
  getProducts,
  getCategories,
  getProductById,
  createProduct,
  createProductDetail,
  createFinancialDetail,
  updateProduct,
  deleteProduct,
  deleteProductDetail,
  updateProductDetail,
  createProductReview,
  getTopProducts,
};