const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const URL = process.env.MONGO_URI;

    if (!URL) {
      throw new Error("❌ MONGO_URI is not defined in .env file!");
    }

    await mongoose.connect(URL); // No options needed

    console.log("✅ Database connected successfully");

    // One-time migration: add retopupBalance to existing wallets
    const Wallet = require("./models/Wallet");
    const result = await Wallet.updateMany(
      { retopupBalance: { $exists: false } },
      { $set: { retopupBalance: 0 } }
    );
    if (result.modifiedCount > 0) {
      console.log(`✅ Migration: Added retopupBalance to ${result.modifiedCount} wallets`);
    }
  } catch (error) {
    console.error(`❌ Database connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
