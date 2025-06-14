const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    ref: 'User'
  },
  wallet_address: {
    type: String,
    required: true
  },
  transactionType: {
    type: String,
    required: true,
    enum: [
      'deposit', 
      'withdrawal', 
      'package_purchase',
      'daily_roi',
      'monthly_roi',
      'referral_bonus',
      'team_bonus',
      'other'
    ]
  },
  transactionHash: {
    type: String,
    required: function() {
      return this.transactionType === 'deposit' || this.transactionType === 'withdrawal';
    }
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    enum: ['CGT', 'USDT', 'BNB', 'ETH', 'BTC'],
    default: 'CGT'
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  packageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Package',
    required: function() {
      return this.transactionType === 'package_purchase' || 
             this.transactionType === 'daily_roi' || 
             this.transactionType === 'monthly_roi';
    }
  },
  remark: {
    type: String,
    trim: true
  },
  // For withdrawals
  toAddress: {
    type: String,
    required: function() {
      return this.transactionType === 'withdrawal';
    }
  },
  // For deposits
  fromAddress: {
    type: String,
    required: function() {
      return this.transactionType === 'deposit';
    }
  },
  // For referral/team bonuses
  relatedUserId: {
    type: String,
    ref: 'User',
    required: function() {
      return this.transactionType === 'referral_bonus' || 
             this.transactionType === 'team_bonus';
    }
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for faster queries
transactionSchema.index({ userId: 1 });
transactionSchema.index({ transactionType: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ createdAt: -1 });
transactionSchema.index({ wallet_address: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);