const mongoose = require('mongoose');

const bankOperationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ownerEmail: { type: String, required: true, lowercase: true, trim: true },
  ownerRole: { type: String, enum: ['user', 'staff', 'admin'], required: true },
  walletType: { type: String, enum: ['user', 'system'], default: 'user' },
  type: { type: String, enum: ['bank_transfer', 'bank_receive', 'currency_convert', 'wallet_send'], required: true },
  amount: { type: Number, required: true },
  fee: { type: Number, default: 0 },
  totalDebit: { type: Number, default: 0 },
  currency: { type: String, default: 'NGN' },
  sourceCurrency: { type: String, default: '' },
  targetCurrency: { type: String, default: '' },
  exchangeRate: { type: Number, default: 0 },
  convertedAmount: { type: Number, default: 0 },
  bankCode: { type: String, default: '' },
  bankName: { type: String, default: '' },
  accountName: { type: String, default: '' },
  accountNumberMasked: { type: String, default: '' },
  recipientCode: { type: String, default: '' },
  providerReference: { type: String, default: '', index: true },
  providerTransferCode: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'otp', 'processing', 'success', 'failed', 'reversed'], default: 'pending' },
  description: { type: String, default: '' },
  providerMessage: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('BankOperation', bankOperationSchema);
