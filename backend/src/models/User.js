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
  alternateEmails: [{ type: String, lowercase: true, trim: true }],
  profilePhoto: {
    data: { type: Buffer, select: false },
    contentType: { type: String, default: '' },
    updatedAt: { type: Date, default: null }
  },
  pinHash: { type: String, default: '' },
  role: { type: String, enum: ['user', 'staff', 'admin', 'reseller'], default: 'user' },
  staffPermissions: [{ type: String }],
  staffApprovalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  active: { type: Boolean, default: true },
  accountStatus: { type: String, enum: ['active', 'suspended', 'disabled'], default: 'active' },
  riskStatus: { type: String, enum: ['normal', 'review', 'suspicious'], default: 'normal' },
  adminNote: { type: String, trim: true, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
