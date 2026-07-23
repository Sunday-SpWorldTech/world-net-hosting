const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true, default: '' },
  company: { type: String, trim: true, default: '' },
  passwordHash: { type: String, required: true },
  githubId: { type: String, index: true, sparse: true, default: '' },
  githubLogin: { type: String, default: '' },
  githubAvatarUrl: { type: String, default: '' },
  pinHash: { type: String, default: '' },
  role: { type: String, enum: ['user', 'staff', 'admin'], default: 'user' },
  staffPermissions: [{ type: String }],
  active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
