const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  project: { type: mongoose.Schema.Types.ObjectId, ref: 'HostingProject', index: true },
  planCode: { type: String, enum: ['free','starter','pro','business'], required: true },
  status: { type: String, enum: ['pending','active','past_due','cancelled','expired'], default: 'pending' },
  billingCycle: { type: String, enum: ['monthly'], default: 'monthly' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'NGN' },
  paymentReference: { type: String, unique: true, sparse: true },
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  autoRenew: { type: Boolean, default: false }
}, { timestamps: true });
module.exports = mongoose.model('HostingSubscription', schema);
