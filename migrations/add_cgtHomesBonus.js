const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const HybridPackage = require("../models/HybridPackage");

// Packages created before this date are treated as having already received the
// CGT Homes join bonus, so they cannot claim it retroactively.
const CLAIMED_CUTOFF = new Date("2026-06-10T00:00:00.000Z");

const migrateCGTHomesBonus = async () => {
  try {
    const URL = process.env.MONGO_URI;
    if (!URL) {
      throw new Error("❌ MONGO_URI is not defined in .env file!");
    }
    await mongoose.connect(URL);
    console.log("✅ Database connected successfully");

    // 1. Initialize the new fields on every document that is missing them.
    const initResult = await HybridPackage.updateMany(
      { cgtHomesBonusClaimed: { $exists: false } },
      { $set: { cgtHomesBonusClaimed: false, cgtHomesBonusClaimedAt: null } }
    );
    console.log(`Initialized fields on ${initResult.modifiedCount} package(s)`);

    // 2. Mark packages created before the cutoff as already claimed.
    const claimedResult = await HybridPackage.updateMany(
      { createdAt: { $lt: CLAIMED_CUTOFF } },
      [{ $set: { cgtHomesBonusClaimed: true, cgtHomesBonusClaimedAt: "$createdAt" } }]
    );
    console.log(`Marked ${claimedResult.modifiedCount} package(s) created before ${CLAIMED_CUTOFF.toISOString()} as claimed`);

    console.log("✅ Migration completed!");

    await mongoose.disconnect();
    console.log("✅ Database disconnected");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
};

// Run migration
migrateCGTHomesBonus();

module.exports = { migrateCGTHomesBonus };
