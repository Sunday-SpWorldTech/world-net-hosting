const mongoose = require('mongoose');

const managedDomainSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true
    },

    domain: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true
    },

    status: {
      type: String,
      default: 'active'
    },

    expiresAt: {
      type: Date
    },

    nameservers: [
      {
        type: String
      }
    ],

    providerReference: {
      type: String,
      default: ''
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('ManagedDomain', managedDomainSchema);