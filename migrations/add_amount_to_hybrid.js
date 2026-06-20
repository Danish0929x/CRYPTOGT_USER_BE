const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config();

const HybridPackage = require("../models/HybridPackage");

const migrateHybridPackages = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/cryptogt");
    console.log("✅ Database connected successfully");

    // Find all packages without amount field
    const packagesWithoutAmount = await HybridPackage.find({
      amount: { $exists: false }
    });

    console.log(`Found ${packagesWithoutAmount.length} packages without amount field`);

    if (packagesWithoutAmount.length === 0) {
      console.log("✅ All packages already have amount field");
      await mongoose.disconnect();
      return;
    }

    // Update all packages to have amount: 10
    const result = await HybridPackage.updateMany(
      { amount: { $exists: false } },
      { $set: { amount: 10 } }
    );

    console.log(`✅ Migration completed!`);
    console.log(`Updated ${result.modifiedCount} documents`);

    await mongoose.disconnect();
    console.log("✅ Database disconnected");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
};

// Run migration
migrateHybridPackages();
