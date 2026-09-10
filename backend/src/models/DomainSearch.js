const mongoose = require('mongoose');

const domainSearchSchema = new mongoose.Schema({
  query: { type: String, required: true },
  results: [{ type: mongoose.Schema.Types.Mixed }],
  source: { type: String, default: 'fallback' },
  apiMessage: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('DomainSearch', domainSearchSchema);
