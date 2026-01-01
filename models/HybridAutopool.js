// models/HybridAutopool.js
const mongoose = require('mongoose');

const hybridAutopoolSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    ref: 'User'
  },
  parentId: {    
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
  completedLevels: {
    type: [Number],
    default: []
  },
  directRewards: {
    type: Boolean,
    default: false
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
