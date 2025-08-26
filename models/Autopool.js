// models/Autopool.js
const mongoose = require('mongoose');

const autopoolSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    ref: 'User'
  },
  leftNode: {
    type: String,
    ref: 'User',
    default: null
  },
  rightNode: {
    type: String,
    ref: 'User',
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'pending'],
    default: 'active'
  },
  level: {
    type: Number,
    default: 1
  },
  isCompleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for faster queries
autopoolSchema.index({ rightNode: 1 });
autopoolSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Autopool', autopoolSchema);