require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const { hashPassword, generateRandomPassword } = require('../utils/passwordUtils');
const fs = require('fs');
const path = require('path');

async function generateInitialPasswords() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    const users = await User.find({ password: null });
    console.log(`Found ${users.length} users without passwords\n`);

    const passwordData = [];
    let updatedCount = 0;

    for (const user of users) {
      const tempPassword = generateRandomPassword();
      const hashedPassword = await hashPassword(tempPassword);

      user.password = hashedPassword;
      user.isEmailVerified = false;
      await user.save();

      passwordData.push({
        userId: user.userId,
        email: user.email,
        walletAddress: user.walletAddress,
        temporaryPassword: tempPassword,
        createdAt: new Date().toISOString()
      });

      updatedCount++;
      console.log(`✓ Generated password for ${user.userId}`);
    }

    const csvPath = path.join(__dirname, `passwords_${Date.now()}.csv`);
    const csvHeader = 'User ID,Email,Wallet Address,Temporary Password,Created At\n';
    const csvRows = passwordData.map(row =>
      `${row.userId},"${row.email}","${row.walletAddress}","${row.temporaryPassword}",${row.createdAt}`
    ).join('\n');

    fs.writeFileSync(csvPath, csvHeader + csvRows);

    console.log(`\n✓ Password generation completed!`);
    console.log(`✓ Updated ${updatedCount} users`);
    console.log(`✓ CSV file saved to: ${csvPath}`);
    console.log('\nNext steps:');
    console.log('1. Use the CSV file to send emails with temporary passwords');
    console.log('2. Users should change their password on first login');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

generateInitialPasswords();
