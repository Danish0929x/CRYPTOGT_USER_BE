const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const URL = process.env.MONGO_URI;

    if (!URL) {
      throw new Error("❌ MONGO_URI is not defined in .env file!");
    }

    await mongoose.connect(URL); // No options needed

    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error(`❌ Database connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
