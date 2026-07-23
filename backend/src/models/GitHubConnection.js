const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  installationId: { type: Number, required: true, index: true },
  accountLogin: { type: String, default: '' },
  accountType: { type: String, default: '' },
  avatarUrl: { type: String, default: '' },
  repositorySelection: { type: String, default: 'selected' },
  suspendedAt: Date
}, { timestamps: true });
module.exports = mongoose.model('GitHubConnection', schema);
