import mongoose from 'mongoose';

const promotionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    discountPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    promoCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    scope: {
      type: String,
      enum: ['product', 'totalBill', 'order'],
      required: true,
      default: 'product',
    },
    applicableProducts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    applicableOrders: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
      },
    ],
    conditions: {
      brand: {
        type: String,
        required: false,
        trim: true,
      },
      minWeight: {
        type: Number,
        required: false,
      },
      maxWeight: {
        type: Number,
        required: false,
      },
      minDprice: {
        type: Number,
        required: false,
      },
      maxDprice: {
        type: Number,
        required: false,
      },
      priceRange: {
        minPrice: {
          type: Number,
          required: false,
        },
        maxPrice: {
          type: Number,
          required: false,
        }
      },
      minTotalBillAmount: {
        type: Number,
        required: false,
      },
      minOrderAmount: {
        type: Number,
        required: false,
      },
      orderCount: {
        type: Number,
        required: false,
      },
      eligibleBrands: [
        {
          type: String,
          required: false,
        },
      ],
    },
    image: {
      type: String,
      required: false,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Promotion = mongoose.model('Promotion', promotionSchema);

export default Promotion;
