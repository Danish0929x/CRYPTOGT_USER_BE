const mongoose = require("mongoose");

const matrixPackageSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true, // One matrix entry per user
      index: true,
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
      ref: "MatrixPackage",
    },
    leftChildId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "MatrixPackage",
    },
    rightChildId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "MatrixPackage",
    },
    status: {
      type: String,
      enum: ["Active", "Inactive"],
      default: "Active",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MatrixPackage", matrixPackageSchema);
