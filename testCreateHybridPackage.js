const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/User');
const HybridPackage = require('./models/HybridPackage');

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
  const txnId = process.argv[3] || `test_txn_${Date.now()}`;

  if (!userId) {
    console.log('Usage: node testCreateHybridPackage.js <userId> [txnId]');
    console.log('Example: node testCreateHybridPackage.js CGT1234567');
    console.log('Example: node testCreateHybridPackage.js CGT1234567 custom_txn_id_123');
    process.exit(1);
  }

  await connectDB();

  console.log('=== VALIDATING USER ===');
  console.log('User ID:', userId);
  console.log('Transaction ID:', txnId);

  // Check if user exists
  const user = await User.findOne({ userId: userId });
  if (!user) {
    console.log('❌ ERROR: User not found!');
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log('✓ User found:', user.name);
  console.log('✓ User parentId:', user.parentId || 'None');

  // Check if user already has a hybrid package
  const existingPackage = await HybridPackage.findOne({ userId: userId });
  if (existingPackage) {
    console.log('❌ ERROR: User already has a hybrid package!');
    console.log('   Existing package position:', existingPackage.position);
    console.log('   Package ID:', existingPackage._id);
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log('✓ User has no existing hybrid package - can proceed');

  // Show parent info if exists
  if (user.parentId) {
    const parentHybridPackage = await HybridPackage.findOne({ userId: user.parentId });

    if (parentHybridPackage) {
      console.log('\n=== PARENT INFO ===');
      console.log('Parent userId:', user.parentId);
      console.log('Parent position:', parentHybridPackage.position);
      console.log('Parent leftChildId:', parentHybridPackage.leftChildId ? 'Filled' : 'Empty');
      console.log('Parent rightChildId:', parentHybridPackage.rightChildId ? 'Filled' : 'Empty');

      // Count siblings
      const siblings = await User.find({ parentId: user.parentId }).select('userId');
      const siblingUserIds = siblings.map(u => u.userId);

      const siblingsWithPackages = await HybridPackage.find({
        userId: { $in: siblingUserIds }
      }).select('userId position');

      console.log('\n=== SIBLING INFO ===');
      console.log(`Total siblings (including this user): ${siblings.length}`);
      console.log(`Siblings with packages already: ${siblingsWithPackages.length}`);
      console.log('Sibling packages:', siblingsWithPackages.map(p => ({ userId: p.userId, position: p.position })));
      console.log(`This user will be sibling #${siblingsWithPackages.length + 1}`);
    } else {
      console.log('\n=== PARENT INFO ===');
      console.log('Parent has no hybrid package yet');
    }
  }

  // Show tree stats
  const totalPackages = await HybridPackage.countDocuments();
  const highestPackage = await HybridPackage.findOne().sort({ position: -1 }).select('position');

  console.log('\n=== TREE STATS ===');
  console.log('Total hybrid packages in tree:', totalPackages);
  console.log('Highest position:', highestPackage?.position || 0);

  // Import and call createHybridPackage
  console.log('\n=== CREATING HYBRID PACKAGE ===');

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
      console.log('\n=== RESULT ===');
      console.log('Status Code:', this.statusCode);
      console.log('Success:', data.success);
      console.log('Message:', data.message);

      if (data.success && data.data) {
        console.log('\n=== PACKAGE DETAILS ===');
        console.log('Package ID:', data.data._id);
        console.log('Position:', data.data.position);
        console.log('Parent Package ID:', data.data.parentPackageId || 'None (root)');
        console.log('Placed As:', data.data.placedAs);
        console.log('Status:', data.data.status);
        console.log('Created At:', data.data.createdAt);
      } else if (!data.success) {
        console.log('\n❌ ERROR:', data.message);
        if (data.error) {
          console.log('Error details:', data.error);
        }
      }

      return this;
    }
  };

  // Call the createHybridPackage function
  try {
    await createHybridPackage(req, res);
  } catch (error) {
    console.error('\n❌ UNEXPECTED ERROR:', error.message);
    console.error('Stack:', error.stack);
  }

  await mongoose.connection.close();
  console.log('\n✓ Test completed');
  process.exit(0);
};

main();
