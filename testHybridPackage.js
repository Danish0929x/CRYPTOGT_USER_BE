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

// Generate random userId
const generateUserId = () => {
  const randomNum = Math.floor(Math.random() * 9000000) + 1000000; // 7 digit number
  return `CGT${randomNum}`;
};

// Main execution
const main = async () => {
  const parentId = process.argv[2];

  if (!parentId) {
    console.log('Usage: node testHybridPackage.js <parentId>');
    console.log('Example: node testHybridPackage.js CGT0159');
    process.exit(1);
  }

  await connectDB();

  console.log('=== VALIDATING PARENT ===');
  console.log('Parent ID:', parentId);

  // Check if parent exists
  const parentUser = await User.findOne({ userId: parentId });
  if (!parentUser) {
    console.log('❌ ERROR: Parent user not found!');
    await mongoose.connection.close();
    process.exit(1);
  }
  console.log('✓ Parent user found:', parentUser.name);

  console.log('\n=== CREATING TEST USER ===');

  // Generate new userId
  const newUserId = generateUserId();
  console.log('Generated User ID:', newUserId);

  // Create new user with the specified parentId (matching register controller)
  const walletAddress = `0x${Math.random().toString(16).substr(2, 40)}`;

  const newUser = await User.create({
    walletAddress: walletAddress,
    userId: newUserId,
    name: `Test User ${newUserId}`,
    email: `${newUserId.toLowerCase()}@test.com`,
    phone: `9${Math.floor(Math.random() * 900000000) + 100000000}`,
    parentId: parentId,
    verified: true,
    rewardStatus: "User", // Required field
    blockStatus: false
  });

  // Create wallet for the user (matching register controller)
  await Wallet.create({
    userId: newUserId,
    USDTBalance: 0,
    autopoolBalance: 0,
    utilityBalance: 0
  });

  console.log('✓ Test user created successfully');
  console.log('✓ Wallet created successfully\n');

  // Step 1: Verify user was created
  const user = await User.findOne({ userId: newUserId });
  console.log('=== USER INFO ===');
  console.log('User ID:', user.userId);
  console.log('User parentId:', user.parentId);
  console.log('');

  // Step 2: Check if parentId has hybrid package
  const parentHybridPackage = await HybridPackage.findOne({ userId: user.parentId });

  if (!parentHybridPackage) {
    console.log('Parent has no hybrid package - will use sequential placement');
  } else {
    console.log('\nParent hybrid package position:', parentHybridPackage.position);
    console.log('Parent leftChildId:', parentHybridPackage.leftChildId ? 'Filled' : 'Empty');
    console.log('Parent rightChildId:', parentHybridPackage.rightChildId ? 'Filled' : 'Empty');

    // Step 3: Count siblings (users with same parentId) who already have hybrid packages
    const siblings = await User.find({ parentId: user.parentId }).select('userId');
    const siblingUserIds = siblings.map(u => u.userId);
    console.log(`\nTotal siblings (including current user): ${siblings.length}`);

    const siblingsWithPackages = await HybridPackage.find({
      userId: { $in: siblingUserIds }
    }).select('userId position');

    const siblingCount = siblingsWithPackages.length;
    console.log(`Siblings who already have hybrid packages: ${siblingCount}`);
    console.log('Sibling packages:', siblingsWithPackages.map(p => ({ userId: p.userId, position: p.position })));

    console.log(`\nCurrent user will be sibling #${siblingCount + 1}`);

    // Decision logic
    let useDirectPlacement = false;

    if (siblingCount === 2) {
      // 3rd sibling - try to fill parent's LEFT child first, then RIGHT if left is filled
      if (!parentHybridPackage.leftChildId) {
        const newPosition = parentHybridPackage.position * 2;
        console.log(`\n✓ DIRECT PLACEMENT: Fill parent's LEFT child at position ${newPosition}`);
        useDirectPlacement = true;
      } else if (!parentHybridPackage.rightChildId) {
        const newPosition = parentHybridPackage.position * 2 + 1;
        console.log(`\n✓ DIRECT PLACEMENT: Fill parent's RIGHT child at position ${newPosition}`);
        console.log('(Left was filled, so filling right instead)');
        useDirectPlacement = true;
      } else {
        console.log(`\n⚠ Parent's both children are already filled - falling back to SEQUENTIAL placement`);
      }
    } else if (siblingCount === 3) {
      // 4th sibling - try to fill parent's RIGHT child first, then LEFT if right is filled
      if (!parentHybridPackage.rightChildId) {
        const newPosition = parentHybridPackage.position * 2 + 1;
        console.log(`\n✓ DIRECT PLACEMENT: Fill parent's RIGHT child at position ${newPosition}`);
        useDirectPlacement = true;
      } else if (!parentHybridPackage.leftChildId) {
        const newPosition = parentHybridPackage.position * 2;
        console.log(`\n✓ DIRECT PLACEMENT: Fill parent's LEFT child at position ${newPosition}`);
        console.log('(Right was filled, so filling left instead)');
        useDirectPlacement = true;
      } else {
        console.log(`\n⚠ Parent's both children are already filled - falling back to SEQUENTIAL placement`);
      }
    } else {
      console.log(`\n✓ SEQUENTIAL PLACEMENT: Sibling count is ${siblingCount + 1} (not 3rd or 4th)`);
    }

    // Sequential placement logic (for 1st, 2nd, 5th+ siblings OR when direct placement fails)
    if (!useDirectPlacement) {
      console.log('\n--- SEQUENTIAL PLACEMENT LOGIC ---');
      console.log('Finding next available position...\n');

      // First, get the highest current position
      const highestPackage = await HybridPackage.findOne()
        .sort({ position: -1 })
        .select('position');

      const currentHighest = highestPackage?.position || 0;
      console.log('Current highest position in tree:', currentHighest);

      // Calculate what the next position should be
      const nextPosition = currentHighest + 1;
      console.log('Next position should be:', nextPosition);

      // Calculate the parent position for the next position
      const parentPositionForNext = Math.floor(nextPosition / 2);
      console.log('Parent position for next:', parentPositionForNext);

      // Check if that parent exists
      const parentPackage = await HybridPackage.findOne({ position: parentPositionForNext })
        .select('position leftChildId rightChildId userId');

      if (parentPackage) {
        console.log(`\n✓ Parent package found at position ${parentPositionForNext} (userId: ${parentPackage.userId})`);

        const leftChildPos = parentPackage.position * 2;
        const rightChildPos = parentPackage.position * 2 + 1;

        console.log(`  Left child (${leftChildPos}): ${parentPackage.leftChildId ? 'Filled' : 'EMPTY'}`);
        console.log(`  Right child (${rightChildPos}): ${parentPackage.rightChildId ? 'EMPTY' : 'Filled'}`);

        // Determine which slot would be next
        if (nextPosition % 2 === 0) {
          // Even position = left child
          if (!parentPackage.leftChildId) {
            console.log(`\n✓✓✓ NEXT POSITION FOUND: ${nextPosition} (LEFT child of ${parentPositionForNext})`);
          } else {
            console.log(`\n⚠ ERROR: Left child slot is already filled but position ${nextPosition} doesn't exist!`);
          }
        } else {
          // Odd position = right child
          if (!parentPackage.rightChildId) {
            console.log(`\n✓✓✓ NEXT POSITION FOUND: ${nextPosition} (RIGHT child of ${parentPositionForNext})`);
          } else {
            console.log(`\n⚠ ERROR: Right child slot is already filled but position ${nextPosition} doesn't exist!`);
          }
        }
      } else {
        console.log(`\n⚠ ERROR: Parent position ${parentPositionForNext} does not exist!`);
        console.log('This indicates gaps in the tree structure.');
      }
    }
  }

  // Step 4: Actually create the hybrid package
  console.log('\n=== CREATING HYBRID PACKAGE ===');

  const { createHybridPackage } = require('./controllers/packageController');

  // Mock request and response objects
  const req = {
    user: { userId: newUserId },
    body: { txnId: `test_txn_${Date.now()}` }
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
      console.log('\n=== HYBRID PACKAGE CREATED ===');
      console.log('Status:', this.statusCode);
      console.log('Success:', data.success);
      console.log('Message:', data.message);
      if (data.data) {
        console.log('Package ID:', data.data._id);
        console.log('Position:', data.data.position);
        console.log('Parent Package ID:', data.data.parentPackageId);
        console.log('Placed As:', data.data.placedAs);
      }
      return this;
    }
  };

  // Call the createHybridPackage function
  await createHybridPackage(req, res);

  // Cleanup: Commented out - keeping test data for verification
  // console.log('\n=== CLEANUP ===');
  // console.log('Deleting test user, wallet, and hybrid package...');
  // await HybridPackage.deleteOne({ userId: newUserId });
  // await User.deleteOne({ userId: newUserId });
  // await Wallet.deleteOne({ userId: newUserId });
  // console.log('✓ Test data deleted');

  await mongoose.connection.close();
  console.log('\n✓ Test completed successfully - Data saved to database');
  process.exit(0);
};

main();
