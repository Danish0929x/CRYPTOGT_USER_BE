require('dotenv').config();
const mongoose = require('mongoose');
const { migrateHybridBalance } = require('./migrations/add_hybridBalance');

/**
 * Temporary script to run the hybridBalance migration
 * Execute with: node run_migration.js
 */
async function runMigration() {
  try {
    // Connect to MongoDB using MONGO_URI from .env
    const mongodbUri = process.env.MONGO_URI;

    if (!mongodbUri) {
      throw new Error('MONGO_URI is not defined in .env file');
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongodbUri);

    console.log('Connected to MongoDB successfully!');

    // Run the migration
    const migrationResult = await migrateHybridBalance();

    console.log('\n=== Migration Result ===');
    console.log(`Success: ${migrationResult.success}`);
    console.log(`Message: ${migrationResult.message}`);
    console.log(`Modified: ${migrationResult.modifiedCount} wallets`);
    console.log(`Matched: ${migrationResult.matchedCount} wallets`);

    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during migration:', error.message);
    process.exit(1);
  }
}

runMigration();
