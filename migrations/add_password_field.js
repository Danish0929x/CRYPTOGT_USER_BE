const mongoose = require('mongoose');
const User = require('../models/User');

async function migrateAddPasswordField() {
  try {
    console.log('Starting migration: Adding password field to existing users...');

    const result = await User.updateMany(
      { password: { $exists: false } },
      {
        $set: {
          password: null,
          isEmailVerified: false
        }
      }
    );

    console.log('Migration completed successfully!');
    console.log(`Updated documents: ${result.modifiedCount}`);
    console.log(`Matched documents: ${result.matchedCount}`);

    return {
      success: true,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      message: `Successfully added password field to ${result.modifiedCount} users`
    };
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

module.exports = { migrateAddPasswordField };
