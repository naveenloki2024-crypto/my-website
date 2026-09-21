const Product = require('./Product');
const User = require('./User');
const Admin = require('./Admin');
const {
  Order,
  orderItemSchema,
  orderStatusHistorySchema,
  orderMessageSchema,
  ALLOWED_ORDER_STATUS,
  ALLOWED_PAYMENT_STATUS
} = require('./Order');

module.exports = {
  Product,
  User,
  Admin,
  Order,
  orderItemSchema,
  orderStatusHistorySchema,
  orderMessageSchema,
  ALLOWED_ORDER_STATUS,
  ALLOWED_PAYMENT_STATUS
};