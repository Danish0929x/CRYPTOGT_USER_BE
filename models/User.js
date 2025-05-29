const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true
  },
  fullname: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: true
  },
  password: {
    type: String,
    required: true
  },
  referrer: { 
    type: String,
    required: true
    // default: null
  },
  verified: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ["Active", "Inactive"],
    default: "Inactive"
  },
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);