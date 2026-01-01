// models/HybridPackage.js
const mongoose = require("mongoose");

const hybridPackageSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    txnId: {
      type: String,
      required: true,
    },
    position: {
      type: Number,
      unique: true,
      sparse: true,
      index: true,
    },
    parentPackageId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "HybridPackage",
    },
    leftChildId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "HybridPackage",
    },
    rightChildId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "HybridPackage",
    },
    status: {
      type: String,
      enum: ["Active", "Inactive", "Mature"],
      default: "Active",
    },
    bonusGenerated: {
      type: Number,
      default: 0,
    },
    bonusWithdrawn: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("HybridPackage", hybridPackageSchema);
