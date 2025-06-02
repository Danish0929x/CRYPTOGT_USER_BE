// models/Package.js
const mongoose = require('mongoose');

const packageSchema = new mongoose.Schema({
    userId: {
    type: String,
    required: true,
  },
   name: {
    type: String,
    required: true,
    enum: ['Silver', 'Gold'] 
  },
  packageAmount: {
    type: Number,
    required: true
  },
  daily_roi: {
    type: Number,
    required: true
  },
  monthly_roi: {
    type: Number,
    required: true
  },
  duration: {
    type: Number, // in days?
    required: true
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  endDate: {
    type: Date, // calculated based on duration
    default: null,                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         
  },
  status: {
    type: String,
    enum: ["Active", "Inactive"],
    default: "Active"
  }
  
}, { timestamps: true });

module.exports = mongoose.model('Package', packageSchema);