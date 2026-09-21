require('dotenv').config();

const mongoose = require('mongoose');
const { Schema } = mongoose;

const idTransform = (doc, ret) => {
  ret.id = ret._id && ret._id.toString();
  delete ret._id;
  return ret;
};

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, trim: true, default: null },
  phone: { type: String, trim: true, default: null },
  shippingAddress: { type: Schema.Types.Mixed, default: null }
}, {
  timestamps: true,
  versionKey: false,
  toJSON: { transform: idTransform }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports = User;