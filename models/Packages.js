// models/Package.js
const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    packageType: {
      type: String,
      required: true,
      enum: ["Leader", "Investor", "Hybrid"],
      default: "Leader",
    },
    packageAmount: {
      type: Number,
      required: true,
    },
    cgtCoin: {
      type: Number, // CGT Coin
      required: true,
    },
    txnId: {
      type: String,
    },
    poi: {
      type: Number,
      required: true,
    },
    directBonus: {
      type: Boolean,
      default: false,
    },
    productVoucher: {
      type: Boolean,
      default: false,
    },
    directMember: {
      type: [String],
      default: [],
    },
    type: {
      type: String,
      required: true,
      enum: ["Buy", "ReTopup", "BuyHybrid"],
      default: "Buy",
    },
    startDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Requested", "Matured"],
      default: "Requested",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Package", packageSchema);
