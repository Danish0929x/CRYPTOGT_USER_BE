const mongoose = require("mongoose");

// Each document = one user's entry in one specific stage (e.g., HM1-P1, HM2-P3, etc.)
// A user can have up to 15 entries (one per stage) as they progress
const matrixPackageSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    hm: {
      type: Number,
      required: true,
      min: 1,
      max: 6,
    },
    part: {
      type: Number,
      required: true,
      min: 1,
      max: 3,
    },
    position: {
      type: Number,
      index: true,
    },
    parentPackageId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "MatrixPackage",
    },
    children: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "MatrixPackage",
      },
    ],
    status: {
      type: String,
      enum: ["Active", "Completed"],
      default: "Active",
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

matrixPackageSchema.index({ hm: 1, part: 1, position: 1 }, { unique: true });
matrixPackageSchema.index({ userId: 1, hm: 1, part: 1 }, { unique: true });

module.exports = mongoose.model("MatrixPackage", matrixPackageSchema);
