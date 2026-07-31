const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  company: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: false, default: '' },
  password: { type: String, select: false, default: '' },
  password_hash: { type: String, select: false, default: '' },
  emailAddress: { type: String, lowercase: true, trim: true, default: '' },
  pinHash: { type: String, default: '' },
  role: { type: String, enum: ['user', 'staff', 'reseller'], default: 'user' },
  staffPermissions: [{ type: String }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
