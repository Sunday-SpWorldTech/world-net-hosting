const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requesterEmail: { type: String, required: true, lowercase: true, trim: true },
  requesterRole: { type: String, enum: ['user','staff','admin'], required: true },
  walletType: { type: String, enum: ['user','system'], default: 'user' },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'NGN' },
  bankName: { type: String, required: true, trim: true },
  accountName: { type: String, required: true, trim: true },
  accountNumberMasked: { type: String, required: true },
  accountNumberEncrypted: { type: String, required: true },
  note: { type: String, default: '' },
  status: { type: String, enum: ['pending','approved','paid','rejected','cancelled'], default: 'pending' },
  reviewedBy: { type: String, default: '' },
  reviewNote: { type: String, default: '' },
  payoutReference: { type: String, default: '' },
  processedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
