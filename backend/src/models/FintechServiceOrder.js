
const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  service: { type: String, enum: ['us_card','naira_card','virtual_account'], required: true, index: true },
  providerCost: { type: Number, required: true, min: 0 },
  customerPrice: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true },
  paymentCurrency: { type: String, required: true },
  exchangeRate: { type: Number, required: true, min: 0 },
  paymentAmount: { type: Number, required: true, min: 0 },
  paymentReference: { type: String, default: '', index: true },
  providerReference: { type: String, default: '', index: true },
  providerStatus: { type: String, default: '' },
  status: { type: String, enum: ['payment_pending','payment_verified','fulfilling','fulfilled','payment_failed','fulfillment_failed','provider_failed'], default: 'payment_pending', index: true },
  failureMessage: { type: String, default: '' },
  paymentVerifiedAt: { type: Date, default: null },
  fulfilledAt: { type: Date, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });
module.exports = mongoose.model('FintechServiceOrder', schema);
