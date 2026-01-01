// models/HybridAutopool.js
const mongoose = require('mongoose');

const hybridAutopoolSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    ref: 'User'
  },
  position: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  parentPosition: {
    type: Number,
    default: 0 // 0 for root node
  },
  leftChildPosition: {
    type: Number,
    default: null
  },
  rightChildPosition: {
    type: Number,
    default: null
  },
  currentLevel: {
    type: Number,
    default: 0 // 0 means no children or incomplete
  },
  completedLevels: {
    type: [Number],
    default: []
  },
  directReferrals: {
    type: Number,
    default: 0
  },
  earnings: {
    level1: { type: Number, default: 0 },
    level2: { type: Number, default: 0 },
    level3: { type: Number, default: 0 },
    level4: { type: Number, default: 0 },
    level5: { type: Number, default: 0 },
    level6: { type: Number, default: 0 },
    level7: { type: Number, default: 0 },
    level8: { type: Number, default: 0 },
    level9: { type: Number, default: 0 },
    level10: { type: Number, default: 0 },
    level11: { type: Number, default: 0 },
    level12: { type: Number, default: 0 },
    level13: { type: Number, default: 0 },
    level14: { type: Number, default: 0 },
    level15: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  blocked: {
    type: [Number], // Array of levels that were blocked due to direct referral requirement
    default: []
  },
  walletUsed: {
    type: String,
    enum: ['USDTBalance', 'autopoolBalance'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'blocked'],
    default: 'active'
  }
}, {
  timestamps: true
});

// Indexes for faster queries
hybridAutopoolSchema.index({ userId: 1, createdAt: -1 });
hybridAutopoolSchema.index({ parentPosition: 1 });
hybridAutopoolSchema.index({ position: 1 });

module.exports = mongoose.model('HybridAutopool', hybridAutopoolSchema);
