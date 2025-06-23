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
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
