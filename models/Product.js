require('dotenv').config();

const mongoose = require('mongoose');
const { Schema } = mongoose;

const idTransform = (doc, ret) => {
  ret.id = ret._id && ret._id.toString();
  delete ret._id;
  return ret;
};

const productSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 191 },
  slug: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 191 },
  description: { type: String, trim: true, maxlength: 191, default: null },
  price: { type: Number, required: true, default: 0 },
  image: { type: String, trim: true, maxlength: 191, default: null },
  category: { type: String, trim: true, maxlength: 191, default: null },
  stock: { type: Number, default: 0, min: [0, 'stock cannot be negative'] }
}, {
  timestamps: true,
  versionKey: false,
  toJSON: { transform: idTransform }
});

const Product = mongoose.models.Product || mongoose.model('Product', productSchema);

module.exports = Product;