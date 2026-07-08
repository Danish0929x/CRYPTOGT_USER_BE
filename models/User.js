const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
    },
    phone: {
      type: String,
      default: null,
    },
    parentId: {
      type: String,
      required: true,
    },
    verified: {
      type: Boolean,
      default: true,
    },
    rewardStatus: {
      type: String,
      enum: [
        "User",
        "Associate",
        "Team Leader",
        "Supervisor",
        "General Manager",
        "Director",
        "President",
        "Star President",
        "Crown Star",
        "Chairman",
      ],
      required: true,
    },

    blockStatus: {
      type: Boolean,
      default: false, // Default to false
    },
    isRewardBlock: {
      type: Boolean,
      default: false, // Default to false
    },
     connectedCGTHomesEmail: {
      type: String,
      default: null,
      sparse: true,
    },
    cgtHomesConnectedAt: {
      type: Date,
      default: null,
    },
    password: {
      type: String,
      default: null,
      sparse: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    resetOTP: {
      type: String,
      default: null,
    },
    resetOTPExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
