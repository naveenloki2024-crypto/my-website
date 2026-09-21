require('dotenv').config();

const mongoose = require('mongoose');
const { Schema } = mongoose;

const idTransform = (doc, ret) => {
  ret.id = ret._id && ret._id.toString();
  delete ret._id;
  return ret;
};

const adminSchema = new Schema({
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  name: { type: String, trim: true, default: null },
  passwordHash: { type: String, required: true }
}, {
  timestamps: true,
  versionKey: false,
  toJSON: { transform: idTransform }
});

const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

module.exports = Admin;