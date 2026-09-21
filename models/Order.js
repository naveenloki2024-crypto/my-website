require('dotenv').config();

const mongoose = require('mongoose');
const { Schema } = mongoose;

const idTransform = (doc, ret) => {
  ret.id = ret._id && ret._id.toString();
  delete ret._id;
  return ret;
};

const orderItemSchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true },
  image: { type: String, default: null }
}, { _id: true, versionKey: false, timestamps: false, toJSON: { transform: idTransform } });

const orderStatusHistorySchema = new Schema({
  oldStatus: { type: String, default: null },
  newStatus: { type: String, required: true },
  adminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
  note: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
}, { _id: true, versionKey: false, toJSON: { transform: idTransform } });

const orderMessageSchema = new Schema({
  adminId: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
  message: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: true, versionKey: false, toJSON: { transform: idTransform } });

const ALLOWED_ORDER_STATUS = ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const ALLOWED_PAYMENT_STATUS = ['UNPAID', 'PAID', 'REFUNDED', 'FAILED'];

const orderSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ALLOWED_ORDER_STATUS, default: 'PENDING' },
  paymentStatus: { type: String, enum: ALLOWED_PAYMENT_STATUS, default: 'UNPAID' },
  totalAmount: { type: Number, default: 0 },
  shippingFee: { type: Number, default: 0 },
  currency: { type: String, default: 'INR' },
  stripeSessionId: { type: String, default: null, unique: true, sparse: true },
  stripePaymentIntent: { type: String, default: null },
  customerName: { type: String, default: null },
  customerEmail: { type: String, default: null },
  customerPhone: { type: String, default: null },
  shippingAddress: { type: Schema.Types.Mixed, default: null },
  cancellationReason: { type: String, default: null },
  items: { type: [orderItemSchema], default: [] },
  statusHistory: { type: [orderStatusHistorySchema], default: [] },
  messages: { type: [orderMessageSchema], default: [] }
}, {
  timestamps: true,
  versionKey: false,
  toJSON: {
    virtuals: true,
    transform(doc, ret) {
      ret.id = ret._id && ret._id.toString();
      delete ret._id;
      return ret;
    }
  }
});

const ALLOWED_STATUS_SET = new Set(ALLOWED_ORDER_STATUS);
const ALLOWED_PAYMENT_STATUS_SET = new Set(ALLOWED_PAYMENT_STATUS);

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

module.exports = {
  Order,
  orderItemSchema,
  orderStatusHistorySchema,
  orderMessageSchema,
  ALLOWED_ORDER_STATUS,
  ALLOWED_PAYMENT_STATUS,
  ALLOWED_STATUS_SET,
  ALLOWED_PAYMENT_STATUS_SET
};