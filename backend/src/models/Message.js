const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  mimeType: { type: String, default: 'application/octet-stream' },
  size: { type: Number, default: 0 },
  data: { type: Buffer, required: true }
}, { _id: true });

const replySchema = new mongoose.Schema({
  body: { type: String, required: true },
  language: { type: String, default: 'en' },
  englishBody: { type: String, default: '' },
  localBody: { type: String, default: '' },
  repliedBy: { type: String, default: 'admin' },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const messageSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  service: { type: String, default: '' },
  subject: { type: String, default: '' },
  message: { type: String, required: true },
  language: { type: String, default: 'en' },
  englishMessage: { type: String, default: '' },
  localMessage: { type: String, default: '' },
  attachments: [attachmentSchema],
  accessTokenHash: { type: String, default: '', select: false },
  source: { type: String, enum: ['contact', 'chat'], default: 'contact' },
  status: { type: String, enum: ['new', 'open', 'replied', 'closed'], default: 'new' },
  replies: [replySchema]
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
