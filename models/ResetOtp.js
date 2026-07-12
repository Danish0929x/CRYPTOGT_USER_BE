const mongoose = require("mongoose");

const resetOtpSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    // Legacy 2Factor.in AUTOGEN session ID (kept optional for in-flight sessions).
    sessionId: {
      type: String,
      default: null,
    },
    // SHA-256 hash of the server-generated OTP. Verified locally.
    otpHash: {
      type: String,
      default: null,
    },
    // Channel the latest OTP was sent through: "email" | "mobile".
    channel: {
      type: String,
      default: "email",
    },
    purpose: {
      type: String,
      default: "resetPassword",
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Auto-expire after 10 minutes
resetOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model("ResetOtp", resetOtpSchema);
