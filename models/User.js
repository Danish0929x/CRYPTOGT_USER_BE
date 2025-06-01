const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  wallet_address: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    default: null
  },
  email: {
    type: String,
    default: null
  },
  phone: {
    type: String,
    default: null
  },
  referral_id: {
    type: String,
    // required: true
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