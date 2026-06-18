import mongoose from 'mongoose';

const orderSchema = mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: 'User',
    },
    orderItems: [
      {
        name: { type: String, required: true },
        quantity: { type: String, required: true },
        units: { type: String, required: true },
        brand: { type: String, required: true },
        qty: { type: Number, required: true },
        image: { type: String, default: '' },
        price: { type: Number, required: true },
        productId: {
          type: mongoose.Schema.Types.ObjectId,
        },
        brandId: {
          type: mongoose.Schema.Types.ObjectId,
        },
        financialId: {
          type: mongoose.Schema.Types.ObjectId,
        },
        barcode: {
          type: [String],
          default: [],
        },
        product: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
          ref: 'Product',
        },
      },
    ],
    remarks: [
      {
        message: { type: String, required: true },
        action: {
          type: String,
          enum: ['ITEMS_ADDED', 'ITEMS_UPDATED', 'ITEMS_REMOVED', 'ORDER_UPDATED', 'ORDER_DELETED'],
          default: 'ORDER_UPDATED',
        },
        createdBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'PosUser',
          default: null,
        },
        createdByName: {
          type: String,
          trim: true,
          default: null,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    shippingAddress: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String },
      location: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: {
          type: [Number],
        },
      },
    },

    paymentMethod: {
      type: String,
      required: true,
    },
    deliverySlot: {
      type: String,
      trim: true,
      default: '',
    },
    paymentBreakdown: [
      {
        channel: { type: String, trim: true, required: true },
        amount: { type: Number, required: true, min: 0 },
      },
    ],
    paymentResult: {
      id: { type: String },
      status: { type: String },
      update_time: { type: String },
      phone_number: { type: String },
    },
    itemsPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    shippingPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    discountPercentage: {
      type: Number,
      required: true,
      default: 0.0,
      min: 0,
      max: 1.5,
    },
    discountAmount: {
      type: Number,
      required: true,
      default: 0.0,
      min: 0,
    },
    totalPrice: {
      type: Number,
      required: true,
      default: 0.0,
    },
    isPaid: {
      type: Boolean,
      required: true,
      default: false,
    },
    paidAt: {
      type: Date,
    },
    isPacked: {
      type: Boolean,
      required: true,
      default: false,
    },
    isDispatched: {
      type: Boolean,
      required: true,
      default: false,
    },
    isDelivered: {
      type: Boolean,
      required: true,
      default: false,
    },

    packedAt: { type: Date },
    dispatchedAt: { type: Date },
    deliveredAt: { type: Date },

    orderId: {
      type: String,
      index: true,
    },

    MK_order_id: {
      type: Number,
      unique: true,
      sparse: true,
      index: true,
    },

    source: {
      type: String,
      enum: ['CASHIER', 'ONLINE', 'ANDROID'],
      required: true,
      default: 'ONLINE',
    },

    // NEW OPTIONAL POS FIELDS
    posUserName: {
      type: String,
      trim: true,
      default: null,
    },
    posLocation: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const Order = mongoose.model('Order', orderSchema);

export default Order;
