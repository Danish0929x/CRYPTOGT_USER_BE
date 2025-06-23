const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
  },
  txHash: {
    type: String
  },
  transactionRemark: {
    type: String
  },
  creditedAmount: {
    type: Number,
    default: 0
  },
  debitedAmount: {
    type: Number,
    default: 0
  },
  fromAddress: {
    type: String
  },
  toAddress: {
    type: String
  },
  walletName: {
    type: String,
    enum: ['CGTBalance', 'autopoolBalance', 'utilityBalance'],
    required: true
  },
  status: {
    type: String,
    required: true
  },
  metadata: mongoose.Schema.Types.Mixed
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);