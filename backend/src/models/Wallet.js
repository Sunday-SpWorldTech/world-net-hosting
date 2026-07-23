const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema({
  type: { type: String, enum: ['credit', 'debit'], required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'NGN' },
  reference: { type: String, default: '' },
  description: { type: String, default: '' },
  status: { type: String, default: 'completed' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const walletSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  balance: { type: Number, default: 0 },
  currency: { type: String, default: process.env.WALLET_CURRENCY || 'NGN' },
  balances: { type: Map, of: Number, default: {} },
  paystackCustomerCode: { type: String, default: '', index: true },
  dedicatedAccount: {
    accountNumber: { type: String, default: '' },
    accountName: { type: String, default: '' },
    bankName: { type: String, default: '' },
    bankSlug: { type: String, default: '' },
    currency: { type: String, default: 'NGN' },
    active: { type: Boolean, default: false }
  },
  transactions: [walletTransactionSchema]
}, { timestamps: true });

module.exports = mongoose.model('Wallet', walletSchema);
