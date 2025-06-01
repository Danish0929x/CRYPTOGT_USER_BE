const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true,
    ref: 'User'
  },
  CGTBalance: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  }
}, { timestamps: true });

module.exports = mongoose.model('Wallet', walletSchema);