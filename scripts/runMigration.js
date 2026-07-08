require('dotenv').config();
const mongoose = require('mongoose');
const { migrateAddPasswordField } = require('../migrations/add_password_field');

async function runMigrations() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    console.log('\n--- Running Migrations ---\n');

    const passwordMigration = await migrateAddPasswordField();

    console.log('\n--- Migration Results ---');
    console.log(passwordMigration);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

runMigrations();
