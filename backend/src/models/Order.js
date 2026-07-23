const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  customerEmail: { type: String, required: true, trim: true, lowercase: true },
  items: [{ type: mongoose.Schema.Types.Mixed }],
  subtotal: { type: Number, default: 0 },
  platformFee: { type: Number, default: 0 },
  platformFeeRate: { type: Number, default: 0 },
  total: { type: Number, required: true },
  status: { type: String, default: 'pending' },
  paymentReference: { type: String, default: '' },
  currency: { type: String, default: 'USD' },
  paymentCurrency: { type: String, default: '' },
  exchangeRate: { type: Number, default: 1 },
  paymentAmount: { type: Number, default: 0 },
  domainProvisionStatus: { type: String, default: 'not_started' },
  domainProvisionMessage: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
