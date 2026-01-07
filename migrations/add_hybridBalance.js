const mongoose = require('mongoose');
const Wallet = require('../models/Wallet');

/**
 * Migration: Add hybridBalance field to all existing wallets
 * This migration initializes hybridBalance to 0 for all wallet documents
 */
async function migrateHybridBalance() {
  try {
    console.log('Starting migration: Adding hybridBalance to existing wallets...');

    // Update all wallets that don't have hybridBalance field
    const result = await Wallet.updateMany(
      { hybridBalance: { $exists: false } },
      { $set: { hybridBalance: 0 } }
    );

    console.log(`Migration completed successfully!`);
    console.log(`Updated documents: ${result.modifiedCount}`);
    console.log(`Matched documents: ${result.matchedCount}`);

    return {
      success: true,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
      message: `Successfully initialized hybridBalance for ${result.modifiedCount} wallets`
    };
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

module.exports = { migrateHybridBalance };
