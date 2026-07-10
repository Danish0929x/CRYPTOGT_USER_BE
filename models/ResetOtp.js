const mongoose = require("mongoose");

const resetOtpSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    // 2Factor.in session ID returned by AUTOGEN. The actual OTP code is held by
    // 2Factor and is never stored here.
    sessionId: {
      type: String,
      required: true,
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
