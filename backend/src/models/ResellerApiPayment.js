const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true, index: true },
  reseller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  resellerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'ResellerProfile', required: true, index: true },
  apiProjectId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  apiProduct: { type: String, enum: ['bank'], default: 'bank' },
  environment: { type: String, enum: ['sandbox','live'], required: true },
  customerEmail: { type: String, required: true, lowercase: true, trim: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'NGN' },
  platformFee: { type: Number, default: 0 },
  resellerNet: { type: Number, default: 0 },
  platformFeeRate: { type: Number, default: 0 },
  description: { type: String, default: '' },
  callbackUrl: { type: String, default: '' },
  provider: { type: String, default: 'paystack' },
  providerStatus: { type: String, default: 'pending' },
  status: { type: String, enum: ['pending','processing','success','failed','reversed'], default: 'pending', index: true },
  settledAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('ResellerApiPayment', schema);
