const mongoose = require("mongoose");

const withdrawOtpSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    sessionId: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      default: "withdrawHybrid",
    },
    verified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Auto-expire after 10 minutes
withdrawOtpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

module.exports = mongoose.model("WithdrawOtp", withdrawOtpSchema);
