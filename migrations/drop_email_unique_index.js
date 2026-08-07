const mongoose = require("mongoose");
const User = require("../models/User");

/**
 * Migration: Drop the legacy UNIQUE index on User.email.
 *
 * Historically `email` had a unique index, so one email could be linked to only
 * one account. The app now allows up to 5 accounts per email (the cap is
 * enforced in application logic — authController.register). The database-level
 * unique index must therefore be removed; otherwise MongoDB rejects the 2nd
 * registration with an E11000 duplicate-key error, regardless of the app code.
 *
 * Idempotent: only drops a single-field UNIQUE index on `email`. It leaves the
 * userId and walletAddress unique indexes untouched, and is a no-op once the
 * index has already been dropped.
 */
async function dropEmailUniqueIndex() {
  try {
    console.log("Starting migration: dropping unique index on User.email...");

    const indexes = await User.collection.indexes();
    const emailUniqueIndex = indexes.find(
      (idx) =>
        idx.unique &&
        idx.key &&
        idx.key.email === 1 &&
        Object.keys(idx.key).length === 1
    );

    if (!emailUniqueIndex) {
      console.log("No unique single-field email index found — nothing to drop.");
      return { success: true, dropped: false };
    }

    await User.collection.dropIndex(emailUniqueIndex.name);

    console.log(`Migration completed: dropped unique email index "${emailUniqueIndex.name}".`);
    console.log("Emails may now repeat (max 5 accounts per email is enforced in application code).");

    return {
      success: true,
      dropped: true,
      indexName: emailUniqueIndex.name,
      message: `Dropped unique email index "${emailUniqueIndex.name}"`,
    };
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

module.exports = { dropEmailUniqueIndex };

// Allow running this migration directly: `node migrations/drop_email_unique_index.js`
if (require.main === module) {
  require("dotenv").config();
  (async () => {
    try {
      console.log("Connecting to MongoDB...");
      await mongoose.connect(process.env.MONGO_URI);
      console.log("Connected to MongoDB");

      const result = await dropEmailUniqueIndex();

      console.log("\n--- Migration Result ---");
      console.log(result);

      await mongoose.disconnect();
      console.log("\nDisconnected from MongoDB");
      process.exit(0);
    } catch (error) {
      console.error("Migration error:", error);
      await mongoose.disconnect();
      process.exit(1);
    }
  })();
}
