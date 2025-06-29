// models/Package.js
const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
    userId: {
    type: String,
    required: true,
  },
  packageType: {
    type: String,
    required: true,
    enum: ['Leader', 'Investor'],
    default: 'Leader'
  },
  packageAmount: {
    type: Number,
    required: true
  },
  cgtCoin: {
    type: Number, // CGT Coin
    required: true
  },
  txnId: {
    type: String
  },
  poi: {
    type: Number,
    required: true
  },
  productVoucher: {
    type: Boolean,
    default: false
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  status: {
    type: Boolean,
    default: true
  }
  
}, { timestamps: true });

module.exports = mongoose.model('Package', packageSchema);