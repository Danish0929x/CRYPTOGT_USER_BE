const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  otp: String,
  userId: String,
  createdAt: { type: Date, expires: '10m', default: Date.now }, // Set expiration time to 5 minutes
});

const OTPModel = mongoose.model('OTP', otpSchema);

module.exports = OTPModel;