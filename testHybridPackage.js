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

  if (!userId) {
    console.log('Usage: node testHybridPackage.js <userId>');
    process.exit(1);
  }

  await connectDB();

  // Step 1: Check sponsor parentId
  const user = await User.findOne({ userId });
  console.log('User parentId:', user ? user.parentId : 'User not found');

  if (!user || !user.parentId) {
    console.log('No parentId found - will use sequential placement');
    await mongoose.connection.close();
    process.exit(0);
    return;
  }

  // Step 2: Check if parentId has hybrid package with both children filled
  const parentHybridPackage = await HybridPackage.findOne({ userId: user.parentId });

  if (!parentHybridPackage) {
    console.log('Parent has no hybrid package - will use sequential placement');
  } else {
    console.log('Parent hybrid package position:', parentHybridPackage.position);
    console.log('Parent leftChildId:', parentHybridPackage.leftChildId ? 'Filled' : 'Empty');
    console.log('Parent rightChildId:', parentHybridPackage.rightChildId ? 'Filled' : 'Empty');

    const bothChildrenFilled = parentHybridPackage.leftChildId && parentHybridPackage.rightChildId;

    if (bothChildrenFilled) {
      console.log('\n✓ Both children are filled - Going to SEQUENTIAL PLACEMENT');
      console.log('Finding lowest empty position...\n');

      // First, get the highest current position
      const highestPackage = await HybridPackage.findOne()
        .sort({ position: -1 })
        .select('position');

      const currentHighest = highestPackage?.position || 0;
      console.log('Current highest position in tree:', currentHighest);

      // Find all packages with empty child slots
      const packagesWithEmptySlots = await HybridPackage.find({
        $or: [
          { leftChildId: null },
          { rightChildId: null }
        ]
      })
        .sort({ position: 1 })
        .select('position leftChildId rightChildId userId');

      console.log(`\nFound ${packagesWithEmptySlots.length} packages with empty slots:\n`);

      let foundNextPosition = false;
      for (const pkg of packagesWithEmptySlots) {
        const leftChildPos = pkg.position * 2;
        const rightChildPos = pkg.position * 2 + 1;

        const hasEmptyLeft = !pkg.leftChildId;
        const hasEmptyRight = !pkg.rightChildId;

        console.log(`Position ${pkg.position} (userId: ${pkg.userId}):`);
        console.log(`  Left child (${leftChildPos}): ${hasEmptyLeft ? 'EMPTY' : 'Filled'}`);
        console.log(`  Right child (${rightChildPos}): ${hasEmptyRight ? 'EMPTY' : 'Filled'}`);

        // Check if this would be the next position after currentHighest
        if (!foundNextPosition) {
          if (hasEmptyLeft && leftChildPos === currentHighest + 1) {
            console.log(`  ✓ THIS IS THE NEXT POSITION: ${leftChildPos}\n`);
            foundNextPosition = true;
          } else if (hasEmptyRight && rightChildPos === currentHighest + 1) {
            console.log(`  ✓ THIS IS THE NEXT POSITION: ${rightChildPos}\n`);
            foundNextPosition = true;
          } else {
            console.log('');
          }
        } else {
          console.log('');
        }
      }

      if (!foundNextPosition) {
        console.log('⚠ No sequential next position found - there might be gaps in the tree');
      }
    } else {
      console.log('\n✓ Parent has empty child slot - Can use DIRECT PLACEMENT');
    }
  }

  await mongoose.connection.close();
  process.exit(0);
};

main();
