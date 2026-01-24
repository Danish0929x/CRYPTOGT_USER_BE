const Package = require("../models/Packages");
const HybridPackage = require("../models/HybridPackage");
const { distributeDirectBonus } = require("../functions/directDistributeBonus");
const getLiveRate = require("../utils/liveRateUtils");
const Wallet = require("../models/Wallet");
const { performWalletTransaction } = require("../utils/performWalletTransaction");
const { handleDirectMembers } = require("../functions/checkProductVoucher");
const User = require("../models/User");
const { sendHybridAmount } = require("../functions/sendHybridAmount");
const { makeCryptoTransaction } = require("../utils/makeUSDTCryptoTransaction");

// Level Configuration based on International AutoPool
const LEVEL_CONFIG = {
  1: { members: 2, percentage: 5, amount: 20, direct: 0 },
  2: { members: 4, percentage: 5, amount: 40, direct: 0 },
  3: { members: 8, percentage: 5, amount: 80, direct: 0 },
  4: { members: 16, percentage: 5, amount: 160, direct: 0 },
  5: { members: 32, percentage: 5, amount: 320, direct: 1 },
  6: { members: 64, percentage: 5, amount: 640, direct: 1 },
  7: { members: 128, percentage: 5, amount: 1280, direct: 2 },
  8: { members: 256, percentage: 5, amount: 2560, direct: 2 },
  9: { members: 512, percentage: 5, amount: 5120, direct: 3 },
  10: { members: 1024, percentage: 5, amount: 10240, direct: 3 },
  11: { members: 2048, percentage: 3, amount: 20460, direct: 4 },
  12: { members: 4096, percentage: 3, amount: 40960, direct: 4 },
  13: { members: 8192, percentage: 3, amount: 81920, direct: 5 },
  14: { members: 16384, percentage: 3, amount: 163840, direct: 10 },
  15: { members: 32768, percentage: 3, amount: 327680, direct: 15 },
};

// Helper function to count total members under a user in the tree
const countTreeMembers = async (packageId) => {
  if (!packageId) return 0;

  const pkg = await HybridPackage.findById(packageId).select(
    "leftChildId rightChildId"
  );

  if (!pkg) return 0;

  let count = 0;
  if (pkg.leftChildId) count += 1 + (await countTreeMembers(pkg.leftChildId));
  if (pkg.rightChildId) count += 1 + (await countTreeMembers(pkg.rightChildId));

  return count;
};

// Count members at each depth level (how many members in each row of binary tree)
const countMembersByDepth = async (packageId, maxDepth = 15) => {
  const depthCounts = {};

  const traverse = async (pkgId, depth) => {
    if (!pkgId || depth > maxDepth) return;

    if (!depthCounts[depth]) {
      depthCounts[depth] = 0;
    }
    depthCounts[depth]++;

    const pkg = await HybridPackage.findById(pkgId).select("leftChildId rightChildId");
    if (!pkg) return;

    if (pkg.leftChildId) {
      await traverse(pkg.leftChildId, depth + 1);
    }
    if (pkg.rightChildId) {
      await traverse(pkg.rightChildId, depth + 1);
    }
  };

  await traverse(packageId, 1);
  return depthCounts;
};

// Helper function to check if a level is achieved
const isLevelAchieved = async (packageId, level) => {
  try {
    const totalMembers = await countTreeMembers(packageId);
    return totalMembers >= LEVEL_CONFIG[level].members;
  } catch (error) {
    console.error("Error checking level achievement:", error);
    return false;
  }
};


exports.createPackage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageAmount, txnId } = req.body;
    const liveRate = await getLiveRate();

    const user = await User.findOne({ userId: userId });
    if(!user){
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    if (!userId || !packageAmount) {
      return res.status(400).json({
        success: false,
        message: "User ID and package amount are required",
      });
    }

    // Determine package type and ROI based on amount
    const packageType = packageAmount <= 1000 ? "Leader" : "Investor";

    // Create new package according to model
    const newPackage = new Package({
      userId,
      packageType,
      cgtCoin: parseFloat((packageAmount / liveRate).toFixed(5)),
      packageAmount,
      txnId,
      poi: 0,
      startDate: new Date(),
      status: "Requested", // Using boolean true instead of string
      type: "Buy" 
    });

    await newPackage.save();

    //productVoucher
    await handleDirectMembers(userId, user.parentId, newPackage._id); // Make sure sponsorId is available in req.user


    // Distribute direct bonus to parent

    // Check if user already had packages before this one
    const existingPackagesCount = await Package.countDocuments({
      userId,
      _id: { $ne: newPackage._id }, // exclude the newly created one
    });

    if (existingPackagesCount > 0) {
      // User already has package → call distributeDirectBonus
      await distributeDirectBonus(newPackage.packageAmount, userId);
    } else {
      // User has no previous package → call distributeUSTDirectBonus
      // await distributeUSTDirectBonus(newPackage.packageAmount, userId);
    }


    res.status(201).json({
      success: true,
      message: "Package created successfully",
      data: newPackage,
    });
  } catch (err) {
    console.error("Error creating package:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

exports.reTopUp = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageAmount } = req.body;
    const liveRate = await getLiveRate();

    if (!userId || !packageAmount) {
      return res.status(400).json({
        success: false,
        message: "User ID and package amount are required",
      });
    }

    const userWallet = await Wallet.findOne({ userId });
    if (!userWallet) {
      return res.status(400).json({
        success: false,
        message: "Wallet not found",
      });
    }

    if (userWallet.USDTBalance < packageAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient USDT balance",
        availableBalance: userWallet.USDTBalance,
        requiredAmount: packageAmount,
      });
    }

    await performWalletTransaction(
      userId,
      -packageAmount, // Negative for debit
      "USDTBalance",
      "Retop up",
      "Completed"
    );
    // Determine package type and ROI based on amount
    const packageType = packageAmount <= 1000 ? "Leader" : "Investor";

    // Create new package according to model
    const newPackage = new Package({
      userId,
      packageType,
      cgtCoin: parseFloat((packageAmount / liveRate).toFixed(5)),
      packageAmount,
      txnId: null,
      poi: 0,
      startDate: new Date(),
      status: "Active", // Using boolean true instead of string
      type: "ReTopup"  
    });

    await newPackage.save();

    // Distribute direct bonus to parent
    await distributeDirectBonus(newPackage.packageAmount, userId);

    res.status(201).json({
      success: true,
      message: "Retop up successfully",
      data: newPackage,
    });
  } catch (err) {
    console.error("Error creating package:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

exports.createHybridPackage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { txnId } = req.body;

    console.log("=== CREATE HYBRID PACKAGE START ===");
    console.log("User ID:", userId);
    console.log("Transaction ID:", txnId);

    // Validate user exists
    const user = await User.findOne({ userId: userId });
    console.log("User found:", user ? `Yes (parentId: ${user.parentId})` : "No");

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user already has a hybrid package
    const existingHybridPackage = await HybridPackage.findOne({ userId });
    console.log("Existing hybrid package:", existingHybridPackage ? "Yes - User already has package" : "No - Can proceed");

    if (existingHybridPackage) {
      return res.status(400).json({
        success: false,
        message: "User can only have one hybrid package",
      });
    }

    let newPosition = null;
    let parentPackageId = null;
    let placedAsDirectChild = false;

    console.log("\n--- PLACEMENT LOGIC START ---");

    // SPONSORED PLACEMENT: Check if user has a parent (referral sponsor)
    if (user.parentId) {
      console.log(`User has parentId: ${user.parentId}, checking sponsored placement...`);

      // Get parent's hybrid package
      const parentHybridPackage = await HybridPackage.findOne({ userId: user.parentId });
      console.log("Parent hybrid package found:", parentHybridPackage ? `Yes (position: ${parentHybridPackage.position})` : "No");

      if (parentHybridPackage) {
        // Calculate parent's row (level) in binary tree
        // Level = floor(log2(position)) + 1
        const parentLevel = Math.floor(Math.log2(parentHybridPackage.position)) + 1;
        const parentRowStart = Math.pow(2, parentLevel - 1);

        console.log(`Parent level: ${parentLevel}, Parent row start position: ${parentRowStart}`);
        console.log(`Parent leftChildId: ${parentHybridPackage.leftChildId || 'null'}, rightChildId: ${parentHybridPackage.rightChildId || 'null'}`);

        // Count siblings (users with same parentId) whose packages are at position >= parent's row start
        // This includes parent's row AND all rows after/below it
        const siblings = await User.find({ parentId: user.parentId }).select('userId');
        const siblingUserIds = siblings.map(u => u.userId);
        console.log(`Found ${siblings.length} total siblings (users with same parentId):`, siblingUserIds);

        const siblingsWithPackagesFromParentRowOnward = await HybridPackage.find({
          userId: { $in: siblingUserIds },
          position: { $gte: parentRowStart }
        });
        const siblingCount = siblingsWithPackagesFromParentRowOnward.length;

        console.log(`Siblings with packages from position ${parentRowStart} onwards: ${siblingCount}`);
        console.log(`Sibling packages:`, siblingsWithPackagesFromParentRowOnward.map(p => ({ userId: p.userId, position: p.position })));

        // 3rd sibling direct (index 2) - place as left child of parent
        if (siblingCount === 2 && !parentHybridPackage.leftChildId) {
          newPosition = parentHybridPackage.position * 2;
          parentPackageId = parentHybridPackage._id;
          placedAsDirectChild = true;
          console.log(`✓ PLACING as 3rd direct sibling (LEFT CHILD) at position ${newPosition}`);
        }
        // 4th sibling direct (index 3) - place as right child of parent
        else if (siblingCount === 3 && !parentHybridPackage.rightChildId) {
          newPosition = parentHybridPackage.position * 2 + 1;
          parentPackageId = parentHybridPackage._id;
          placedAsDirectChild = true;
          console.log(`✓ PLACING as 4th direct sibling (RIGHT CHILD) at position ${newPosition}`);
        }
        // 1st, 2nd, and 5th+ siblings - use sequential placement
        else {
          console.log(`⚠ User is sibling #${siblingCount + 1}, will use SEQUENTIAL placement`);
          console.log(`Reason: siblingCount=${siblingCount}, leftChild=${parentHybridPackage.leftChildId ? 'filled' : 'empty'}, rightChild=${parentHybridPackage.rightChildId ? 'filled' : 'empty'}`);
        }
      } else {
        console.log("Parent has no hybrid package, will use sequential placement");
      }
    } else {
      console.log("User has no parentId, will use sequential placement");
    }

    // SEQUENTIAL PLACEMENT: If not placed as direct child, find next available position
    console.log("\n--- SEQUENTIAL PLACEMENT CHECK ---");
    console.log("placedAsDirectChild:", placedAsDirectChild);

    if (!placedAsDirectChild) {
      console.log("Starting sequential placement...");
      console.log("Searching for first package with empty child slot...");

      // Find the first package with an empty child slot (sorted by position ascending for BFS fill)
      const packageWithEmptySlot = await HybridPackage.findOne({
        $or: [
          { leftChildId: null },
          { rightChildId: null }
        ]
      })
        .sort({ position: 1 }) // Ascending order to fill from lowest position first
        .select('position leftChildId rightChildId userId');

      if (packageWithEmptySlot) {
        parentPackageId = packageWithEmptySlot._id;

        if (!packageWithEmptySlot.leftChildId) {
          // Left child is empty
          newPosition = packageWithEmptySlot.position * 2;
          console.log(`✓ Found package at position ${packageWithEmptySlot.position} (userId: ${packageWithEmptySlot.userId}) with empty LEFT child`);
          console.log(`Placing at position ${newPosition}`);
        } else {
          // Right child is empty
          newPosition = packageWithEmptySlot.position * 2 + 1;
          console.log(`✓ Found package at position ${packageWithEmptySlot.position} (userId: ${packageWithEmptySlot.userId}) with empty RIGHT child`);
          console.log(`Placing at position ${newPosition}`);
        }
      } else {
        // No packages with empty slots found - this shouldn't happen in a growing tree
        console.log("⚠ No packages with empty slots found - tree might be complete or corrupted");

        // Fallback: use highest position + 1
        const highestPackage = await HybridPackage.findOne()
          .sort({ position: -1 })
          .select('position');

        newPosition = (highestPackage?.position || 0) + 1;
        console.log(`Fallback to position: ${newPosition}`);

        if (newPosition > 1) {
          const parentPosition = Math.floor(newPosition / 2);
          const parentPackage = await HybridPackage.findOne({ position: parentPosition });
          if (parentPackage) {
            parentPackageId = parentPackage._id;
          }
        }
      }

      console.log(`✓ SEQUENTIAL PLACEMENT at position ${newPosition} with parent: ${parentPackageId || 'none (root)'}`);
    }

    console.log("\n--- CREATING HYBRID PACKAGE ---");
    console.log("Final position:", newPosition);
    console.log("Final parentPackageId:", parentPackageId);
    console.log("Placement type:", placedAsDirectChild ? "DIRECT CHILD" : "SEQUENTIAL");

    // Create new hybrid package with fixed amount of 10 USDT using HybridPackage model
    const newHybridPackage = new HybridPackage({
      userId,
      position: newPosition,
      parentPackageId,
      txnId: txnId || null,
      status: "Active",
    });

    await newHybridPackage.save();
    console.log("✓ Hybrid package saved successfully with ID:", newHybridPackage._id);

    // Update parent's left or right child reference
    if (parentPackageId) {
      console.log("\n--- UPDATING PARENT REFERENCES ---");
      const parentPackage = await HybridPackage.findById(parentPackageId);

      if (newPosition % 2 === 0) {
        // Even position = left child
        parentPackage.leftChildId = newHybridPackage._id;
        console.log(`Updated parent's LEFT child to: ${newHybridPackage._id}`);
      } else {
        // Odd position = right child
        parentPackage.rightChildId = newHybridPackage._id;
        console.log(`Updated parent's RIGHT child to: ${newHybridPackage._id}`);
      }

      await parentPackage.save();
      console.log("✓ Parent package updated successfully");
    } else {
      console.log("No parent package to update (root position)");
    }

    console.log("\n=== CREATE HYBRID PACKAGE SUCCESS ===");
    console.log("Package ID:", newHybridPackage._id);
    console.log("Position:", newPosition);
    console.log("Placement:", placedAsDirectChild ? "direct_child" : "sequential");

    res.status(201).json({
      success: true,
      message: "Hybrid package created successfully",
      data: {
        ...newHybridPackage.toObject(),
        placedAs: placedAsDirectChild ? "direct_child" : "sequential",
      },
    });
  } catch (err) {
    console.error("Error creating hybrid package:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

exports.getPackagesByUserId = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const packages = await Package.find({ userId })
      .sort({ startDate: -1 })
      .select("packageType packageAmount roi startDate status createdAt");

    const totalAmount = packages.reduce(
      (sum, pkg) => sum + pkg.packageAmount,
      0
    );

    res.status(200).json({
      success: true,
      message: "Packages retrieved successfully",
      totalInvestment: totalAmount,
      data: packages.map((pkg) => ({
        id: pkg._id,
        type: pkg.packageType,
        amount: pkg.packageAmount,
        roi: pkg.roi,
        startDate: pkg.startDate,
        status: pkg.status ? "Active" : "Inactive",
        createdAt: pkg.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch packages",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getHybridPackageByUserId = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Fetch all Hybrid packages for the user using HybridPackage model
    const hybridPackages = await HybridPackage.find({
      userId,
    })
      .sort({ createdAt: -1 });

    // Calculate total investment in Hybrid packages (fixed 10 USDT per package)
    const totalHybridInvestment = hybridPackages.length * 10;

    // Extract claimed levels from packages
    const claimedLevels = new Set();
    const levelDetails = [];

    hybridPackages.forEach((pkg) => {
      if (pkg.levels && Array.isArray(pkg.levels)) {
        pkg.levels.forEach((level) => {
          if (level.status === "Claimed") {
            claimedLevels.add(level.level);
            levelDetails.push({
              level: level.level,
              status: level.status,
              rewardAmount: level.rewardAmount,
              claimedAt: level.claimedAt,
            });
          }
        });
      }
    });

    res.status(200).json({
      success: true,
      message: "Hybrid packages retrieved successfully",
      count: hybridPackages.length,
      totalInvestment: totalHybridInvestment,
      claimedLevels: Array.from(claimedLevels),
      levels: levelDetails,
      data: hybridPackages,
    });
  } catch (error) {
    console.error("Error fetching Hybrid packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Hybrid packages",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getDirectHybridPackages = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get all users whose parentId is the current user
    const directUsers = await User.find({ parentId: userId }).select("userId");
    const directUserIds = directUsers.map((user) => user.userId);

    // If no direct users, return empty array
    if (directUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No direct hybrid packages found",
        count: 0,
        totalInvestment: 0,
        data: [],
      });
    }

    // Fetch all Hybrid packages for direct users using HybridPackage model
    const directHybridPackages = await HybridPackage.find({
      userId: { $in: directUserIds },
    })
      .sort({ createdAt: -1 })
      .select("userId status createdAt");

    // Get user details for display
    const userDetails = await User.find({ userId: { $in: directUserIds } }).select("userId name");
    const userMap = {};
    userDetails.forEach((user) => {
      userMap[user.userId] = user.name;
    });

    // Calculate total investment in Direct Hybrid packages (fixed 10 USDT per package)
    const totalDirectHybridInvestment = directHybridPackages.length * 10;

    res.status(200).json({
      success: true,
      message: "Direct hybrid packages retrieved successfully",
      count: directHybridPackages.length,
      totalInvestment: totalDirectHybridInvestment,
      data: directHybridPackages.map((pkg) => ({
        id: pkg._id,
        userId: pkg.userId,
        userName: userMap[pkg.userId] || "N/A",
        amount: 10,
        type: "Hybrid",
        status: pkg.status,
        createdAt: pkg.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching Direct Hybrid packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Direct Hybrid packages",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getUserLevels = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get user's hybrid package
    const hybridPackage = await HybridPackage.findOne({ userId });

    if (!hybridPackage) {
      return res.status(200).json({
        success: true,
        message: "No hybrid package found",
        data: [],
      });
    }

    // Count members at each depth level
    const depthCounts = await countMembersByDepth(hybridPackage._id);

    // Generate all levels with their status and member counts
    const allLevels = [];
    for (let levelNum = 1; levelNum <= 15; levelNum++) {
      // Check if this level is claimed
      const claimedLevel = hybridPackage.levels.find((l) => l.level === levelNum);

      // Calculate current members for this level
      let currentMembers = 0;
      for (let d = 2; d <= levelNum + 1; d++) {
        currentMembers += depthCounts[d] || 0;
      }

      // Check if level is achieved
      const isAchieved = currentMembers >= LEVEL_CONFIG[levelNum].members;

      allLevels.push({
        level: levelNum,
        status: claimedLevel ? claimedLevel.status : (isAchieved ? "Achieved" : "Pending"),
        rewardAmount: LEVEL_CONFIG[levelNum].amount,
        currentMembers: currentMembers,
        requiredMembers: LEVEL_CONFIG[levelNum].members,
        claimedAt: claimedLevel ? claimedLevel.claimedAt : null,
      });
    }

    res.status(200).json({
      success: true,
      message: "User levels retrieved successfully",
      data: allLevels,
    });
  } catch (error) {
    console.error("Error fetching user levels:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user levels",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getHybridAutopoolTree = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get the current user's hybrid package
    const userPackage = await HybridPackage.findOne({ userId }).select(
      "_id userId position parentPackageId leftChildId rightChildId createdAt"
    );

    if (!userPackage) {
      return res.status(200).json({
        success: true,
        message: "No hybrid package found",
        data: null,
      });
    }

    // Fetch all packages in one query
    const allPackages = await HybridPackage.find({}).select(
      "_id userId position parentPackageId leftChildId rightChildId createdAt"
    ).lean();

    // Create a map for quick lookup
    const packageMap = {};
    allPackages.forEach((pkg) => {
      packageMap[pkg._id] = pkg;
    });

    // Recursive function to build the tree
    const buildTree = (packageId, currentUserId) => {
      if (!packageId) return null;

      const pkg = packageMap[packageId];
      if (!pkg) return null;

      return {
        id: pkg._id.toString(),
        userId: pkg.userId,
        position: pkg.position,
        isCurrentUser: pkg.userId === currentUserId,
        createdAt: pkg.createdAt,
        leftChild: buildTree(pkg.leftChildId, currentUserId),
        rightChild: buildTree(pkg.rightChildId, currentUserId),
      };
    };

    // Build tree starting from current user's package
    const tree = buildTree(userPackage._id, userId);

    res.status(200).json({
      success: true,
      message: "Hybrid autopool tree retrieved successfully",
      data: tree,
    });
  } catch (error) {
    console.error("Error fetching Hybrid Autopool tree:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Hybrid Autopool tree",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.claimLevelReward = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { level } = req.body;

    if (!level || level < 1 || level > 15) {
      return res.status(400).json({
        success: false,
        message: "Invalid level. Level must be between 1 and 15.",
      });
    }

    // Get user's hybrid package
    const hybridPackage = await HybridPackage.findOne({ userId });
    if (!hybridPackage) {
      return res.status(400).json({
        success: false,
        message: "No hybrid package found for user",
      });
    }

    // Check if level already claimed
    const existingLevel = hybridPackage.levels.find((l) => l.level === level);
    if (existingLevel && existingLevel.status === "Claimed") {
      return res.status(400).json({
        success: false,
        message: `Level ${level} has already been claimed`,
      });
    }

    // Get user's wallet to send crypto
    const user = await User.findOne({ userId });
    if (!user || !user.walletAddress) {
      return res.status(400).json({
        success: false,
        message: "User wallet address not found",
      });
    }

    // Check direct referral requirement for levels > 4
    const levelConfig = LEVEL_CONFIG[level];
    if (level > 4 && levelConfig.direct > 0) {
      try {
        // Count direct referrals (users who have this userId as parentId)
        const directCount = await User.countDocuments({ parentId: userId });

        if (directCount < levelConfig.direct) {
          return res.status(400).json({
            success: false,
            message: `Insufficient direct referrals. Level ${level} requires ${levelConfig.direct} direct referrals, but you have ${directCount}.`,
          });
        }
      } catch (error) {
        console.error("Error checking direct referrals:", error);
        return res.status(500).json({
          success: false,
          message: "Error verifying direct referral requirement",
          error: error.message,
        });
      }
    }

    // Calculate reward amount: percentage of amount from LEVEL_CONFIG
    const rewardAmount = (levelConfig.amount * levelConfig.percentage) / 100;

    console.log(`Claiming level ${level} for user ${userId}, reward amount: ${rewardAmount}`);

    // For levels 1-4, call makeCryptoTransaction with full amount
    let txnHash = null;
    if (level >= 1 && level <= 4) {
      try {
        txnHash = await makeCryptoTransaction(rewardAmount, user.walletAddress);
        console.log(`Crypto transaction successful for level ${level}: ${txnHash}`);
      } catch (cryptoError) {
        console.error(`Crypto transaction failed for level ${level}:`, cryptoError);
        return res.status(500).json({
          success: false,
          message: "Failed to process crypto transaction",
          error: cryptoError.message,
        });
      }
    }

    // For levels 5 and 6, split distribution: 50% crypto + 30% wallet balance
    if (level === 5 || level === 6) {
      const cryptoAmount = (rewardAmount * 50) / 100;
      const walletAmount = (rewardAmount * 30) / 100;

      // Send 50% via makeCryptoTransaction
      try {
        txnHash = await makeCryptoTransaction(cryptoAmount, user.walletAddress);
        console.log(`Crypto transaction successful for level ${level}: ${txnHash}`);
      } catch (cryptoError) {
        console.error(`Crypto transaction failed for level ${level}:`, cryptoError);
        return res.status(500).json({
          success: false,
          message: "Failed to process crypto transaction",
          error: cryptoError.message,
        });
      }

      // Add 30% to USDTBalance via performWalletTransaction
      try {
        await performWalletTransaction(
          userId,
          walletAmount,
          "USDTBalance",
          `Level ${level} reward (30% wallet distribution)`,
          "Completed"
        );
        console.log(`Level ${level} wallet distribution successful: ${walletAmount} USDT added to USDTBalance`);
      } catch (walletError) {
        console.error(`Level ${level} wallet distribution failed:`, walletError);
        return res.status(500).json({
          success: false,
          message: `Failed to distribute level ${level} reward to wallet`,
          error: walletError.message,
        });
      }
    }

    // Update the level in the hybrid package
    if (existingLevel) {
      existingLevel.status = "Claimed";
      existingLevel.claimedAt = new Date();
      existingLevel.rewardAmount = rewardAmount;
      if (txnHash) {
        existingLevel.txnHash = txnHash;
      }
    } else {
      hybridPackage.levels.push({
        level,
        status: "Claimed",
        rewardAmount,
        achievedAt: new Date(),
        claimedAt: new Date(),
        txnHash: txnHash || null,
      });
    }

    // Save the hybrid package
    await hybridPackage.save();

    res.status(200).json({
      success: true,
      message: "Reward claimed successfully",
      data: {
        level,
        rewardAmount,
        txnHash: txnHash || null,
      },
    });
  } catch (error) {
    console.error("Error claiming reward:", error);
    res.status(500).json({
      success: false,
      message: "Failed to claim reward",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
