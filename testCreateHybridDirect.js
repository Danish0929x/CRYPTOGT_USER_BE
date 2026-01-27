const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const HybridPackage = require('./models/HybridPackage');
const Wallet = require('./models/Wallet');

// Connect to MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Database connected');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

// Main execution
const main = async () => {
  const userId = process.argv[2];
  const txnId = process.argv[3];

  if (!userId || !txnId) {
    console.log('Usage: node testCreateHybridDirect.js <userId> <txnId>');
    console.log('Example: node testCreateHybridDirect.js CGT1234567 txn_12345');
    process.exit(1);
  }

  await connectDB();

  console.log('=== TESTING CREATE HYBRID PACKAGE ===');
  console.log('User ID:', userId);
  console.log('Transaction ID:', txnId);

  // Check if user exists
  const user = await User.findOne({ userId });
  if (!user) {
    console.log('❌ ERROR: User not found!');
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log('✓ User found:', user.name);
  console.log('  Parent ID:', user.parentId);

  // Import and call createHybridPackage
  const { createHybridPackage } = require('./controllers/packageController');

  // Mock request and response objects
  const req = {
    user: { userId: userId },
    body: { txnId: txnId }
  };

  const res = {
    statusCode: null,
    responseData: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.responseData = data;
      console.log('\n=== HYBRID PACKAGE CREATION RESULT ===');
      console.log('Status Code:', this.statusCode);
      console.log('Success:', data.success);
      console.log('Message:', data.message);
      if (data.data) {
        console.log('Package Details:');
        console.log('  Package ID:', data.data._id);
        console.log('  Position:', data.data.position);
        console.log('  Parent Package ID:', data.data.parentPackageId);
        console.log('  Placement Type:', data.data.placedAs);
        console.log('  Status:', data.data.status);
      }
      return this;
    }
  };

  // Call the createHybridPackage function
  await createHybridPackage(req, res);

  await mongoose.connection.close();
  console.log('\n✓ Test completed');
  process.exit(0);
};

main();
