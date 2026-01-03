const Package = require("../models/Packages");
const HybridPackage = require("../models/HybridPackage");
const { distributeDirectBonus } = require("../functions/directDistributeBonus");
const getLiveRate = require("../utils/liveRateUtils");
const Wallet = require("../models/Wallet");
const { performWalletTransaction } = require("../utils/performWalletTransaction");
const { handleDirectMembers } = require("../functions/checkProductVoucher");
const User = require("../models/User");
const { makeCryptoTransaction } = require("../utils/makeUSDTCryptoTransaction");

// Level Configuration based on International AutoPool
const LEVEL_CONFIG = {
  1: { members: 2, percentage: 5, amount: 20 },
  2: { members: 4, percentage: 5, amount: 40 },
  3: { members: 8, percentage: 5, amount: 80 },
  4: { members: 16, percentage: 5, amount: 160 },
  5: { members: 32, percentage: 5, amount: 320 },
  6: { members: 64, percentage: 5, amount: 640 },
  7: { members: 128, percentage: 5, amount: 1280 },
  8: { members: 256, percentage: 5, amount: 2560 },
  9: { members: 512, percentage: 5, amount: 5120 },
  10: { members: 1024, percentage: 5, amount: 10240 },
  11: { members: 2048, percentage: 3, amount: 20460 },
  12: { members: 4096, percentage: 3, amount: 40960 },
  13: { members: 8192, percentage: 3, amount: 81920 },
  14: { members: 16384, percentage: 3, amount: 163840 },
  15: { members: 32768, percentage: 3, amount: 327680 },
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

// Optimized function to count members at each depth level (batch fetching like getHybridAutopoolTree)
const countMembersByDepth = async (packageId, maxDepth = 15) => {
  if (!packageId) return {};

  const userPackage = await HybridPackage.findById(packageId).select(
    "leftChildId rightChildId"
  ).lean();

  if (!userPackage) return {};

  // Start with user's package IDs
  let packageIds = new Set([packageId.toString()]);
  if (userPackage.leftChildId) packageIds.add(userPackage.leftChildId.toString());
  if (userPackage.rightChildId) packageIds.add(userPackage.rightChildId.toString());

  // Fetch all descendants in batches
  let allPackages = new Map();
  let currentIds = Array.from(packageIds);
  let depth = 0;

  while (currentIds.length > 0 && depth < maxDepth) {
    const packages = await HybridPackage.find({
      _id: { $in: currentIds }
    })
    .select("leftChildId rightChildId")
    .lean();

    const nextLevelIds = new Set();
    
    packages.forEach(pkg => {
      allPackages.set(pkg._id.toString(), pkg);
      if (pkg.leftChildId && !allPackages.has(pkg.leftChildId.toString())) {
        nextLevelIds.add(pkg.leftChildId.toString());
      }
      if (pkg.rightChildId && !allPackages.has(pkg.rightChildId.toString())) {
        nextLevelIds.add(pkg.rightChildId.toString());
      }
    });

    currentIds = Array.from(nextLevelIds);
    depth++;
  }

  // Count members at each depth level using the cached data
  const depthCounts = {};
  
  const countAtDepth = (pkgId, currentDepth) => {
    if (!pkgId || currentDepth > maxDepth) return;
    
    if (!depthCounts[currentDepth]) {
      depthCounts[currentDepth] = 0;
    }
    depthCounts[currentDepth]++;
    
    const pkgIdStr = pkgId.toString();
    const pkg = allPackages.get(pkgIdStr);
    
    if (!pkg) return;
    
    if (pkg.leftChildId) {
      countAtDepth(pkg.leftChildId, currentDepth + 1);
    }
    if (pkg.rightChildId) {
      countAtDepth(pkg.rightChildId, currentDepth + 1);
    }
  };

  countAtDepth(packageId, 1);
  
  return depthCounts;
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

    // Validate user exists
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if user already has a hybrid package
    const existingHybridPackage = await HybridPackage.findOne({ userId });
    if (existingHybridPackage) {
      return res.status(400).json({
        success: false,
        message: "User can only have one hybrid package",
      });
    }

    // Calculate next position in binary tree
    const totalPackages = await HybridPackage.countDocuments();
    const newPosition = totalPackages + 1;

    // Calculate parent position (binary tree logic)
    let parentPackageId = null;
    if (newPosition > 1) {
      const parentPosition = Math.floor(newPosition / 2);
      const parentPackage = await HybridPackage.findOne({ position: parentPosition });

      if (parentPackage) {
        parentPackageId = parentPackage._id;
      }
    }

    // Create new hybrid package with fixed amount of 10 USDT using HybridPackage model
    const newHybridPackage = new HybridPackage({
      userId,
      position: newPosition,
      parentPackageId,
      txnId: txnId || null,
      status: "Active",
    });

    await newHybridPackage.save();

    // Update parent's left or right child reference
    if (parentPackageId) {
      const parentPackage = await HybridPackage.findById(parentPackageId);

      if (newPosition % 2 === 0) {
        // Even position = left child
        parentPackage.leftChildId = newHybridPackage._id;
      } else {
        // Odd position = right child
        parentPackage.rightChildId = newHybridPackage._id;
      }

      await parentPackage.save();
    }

    res.status(201).json({
      success: true,
      message: "Hybrid package created successfully",
      data: newHybridPackage,
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
      .sort({ createdAt: -1 })
      .select("status createdAt levels");

    // Calculate total investment in Hybrid packages (fixed 10 USDT per package)
    const totalHybridInvestment = hybridPackages.length * 10;

    res.status(200).json({
      success: true,
      message: "Hybrid packages retrieved successfully",
      count: hybridPackages.length,
      totalInvestment: totalHybridInvestment,
      data: hybridPackages.map((pkg) => ({
        id: pkg._id,
        amount: 10,
        type: "Hybrid",
        status: pkg.status,
        createdAt: pkg.createdAt,
        levels: pkg.levels || [],
      })),
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
      "userId position parentPackageId leftChildId rightChildId createdAt"
    ).lean();

    if (!userPackage) {
      return res.status(200).json({
        success: true,
        message: "No hybrid package found",
        data: null,
      });
    }

    // Collect all package IDs in the tree starting from user's package
    const collectPackageIds = (pkg, ids = new Set()) => {
      if (!pkg) return ids;
      ids.add(pkg._id.toString());
      if (pkg.leftChildId) ids.add(pkg.leftChildId.toString());
      if (pkg.rightChildId) ids.add(pkg.rightChildId.toString());
      return ids;
    };

    // Start with user's package IDs
    let packageIds = new Set([userPackage._id.toString()]);
    if (userPackage.leftChildId) packageIds.add(userPackage.leftChildId.toString());
    if (userPackage.rightChildId) packageIds.add(userPackage.rightChildId.toString());

    // Fetch all descendants in batches (limit depth to prevent infinite loops)
    let allPackages = new Map();
    let currentIds = Array.from(packageIds);
    let depth = 0;
    const maxDepth = 15; // Reasonable depth limit

    while (currentIds.length > 0 && depth < maxDepth) {
      const packages = await HybridPackage.find({
        _id: { $in: currentIds }
      })
      .select("userId position parentPackageId leftChildId rightChildId createdAt")
      .lean();

      const nextLevelIds = new Set();
      
      packages.forEach(pkg => {
        allPackages.set(pkg._id.toString(), pkg);
        if (pkg.leftChildId && !allPackages.has(pkg.leftChildId.toString())) {
          nextLevelIds.add(pkg.leftChildId.toString());
        }
        if (pkg.rightChildId && !allPackages.has(pkg.rightChildId.toString())) {
          nextLevelIds.add(pkg.rightChildId.toString());
        }
      });

      currentIds = Array.from(nextLevelIds);
      depth++;
    }

    // Build tree from cached packages (non-recursive)
    const buildTree = (packageId, currentUserId) => {
      if (!packageId) return null;
      
      const pkgIdStr = packageId.toString();
      const pkg = allPackages.get(pkgIdStr);
      
      if (!pkg) return null;

      return {
        id: pkg._id,
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

    if (!userId || !level) {
      return res.status(400).json({
        success: false,
        message: "User ID and level are required",
      });
    }

    // Validate level exists in configuration
    if (!LEVEL_CONFIG[level]) {
      return res.status(400).json({
        success: false,
        message: "Invalid level",
      });
    }

    // Check if level is currently available for claiming
    if (level > 4) {
      return res.status(200).json({
        success: false,
        message: "Rewards for Level 5 and above are coming soon. Stay tuned!",
        data: {
          level: level,
          maxAvailableLevel: 4,
        },
      });
    }

    // Get user's hybrid package
    const hybridPackage = await HybridPackage.findOne({ userId });

    if (!hybridPackage) {
      return res.status(404).json({
        success: false,
        message: "Hybrid package not found",
      });
    }

    // Get level configuration
    const levelConfig = LEVEL_CONFIG[level];
    const requiredMembers = levelConfig.members;
    const rewardAmount = levelConfig.amount * (levelConfig.percentage / 100);

    // console.log("\n========== LEVEL REWARD CLAIM VERIFICATION ==========");
    // console.log(`User ID: ${userId}`);
    // console.log(`Requested Level: ${level}`);
    // console.log(`Required Members for Level ${level}: ${requiredMembers}`);
    // console.log(`Reward Amount: $${rewardAmount}`);

    // Count actual members in user's tree at this level
    const actualMembers = await countMembersByDepth(hybridPackage._id, level + 1);
    const membersAtLevel = actualMembers[level + 1] || 0;

    // console.log(`Actual Members at Level ${level}: ${membersAtLevel}`);
    // console.log(`Verification: ${membersAtLevel >= requiredMembers ? "✓ PASSED" : "✗ FAILED"}`);
    // console.log("=====================================================\n");

    // Verify user has reached the level
    if (membersAtLevel < requiredMembers) {
      return res.status(200).json({
        success: false,
        message: `Level not achieved. You have ${membersAtLevel} members but need ${requiredMembers} members at level ${level}`,
        data: {
          currentMembers: membersAtLevel,
          requiredMembers: requiredMembers,
          level: level,
        },
      });
    }

    // Check if already claimed
    const userLevel = hybridPackage.levels.find((l) => l.level === level);
    if (userLevel && userLevel.status === "Claimed") {
      return res.status(200).json({
        success: false,
        message: "Reward already claimed for this level",
      });
    }

    // console.log(`✓ VERIFIED: User ${userId} is eligible to claim level ${level} reward`);
    // console.log(`Next step: Distribute $${rewardAmount} to user wallet`);

    // Get user's wallet
    const userWallet = await User.findOne({ userId });
    if (!userWallet) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!userWallet.walletAddress) {
      return res.status(400).json({
        success: false,
        message: "User wallet address not found",
      });
    }

    // Distribute reward to user's USDT wallet via blockchain transaction
    // console.log(`\n🚀 Initiating blockchain transaction...`);
    // console.log(`Amount: ${rewardAmount} USDT`);
    // console.log(`Recipient: ${userWallet.walletAddress}`);
    
    let txnId;
    try {
      txnId = await makeCryptoTransaction(rewardAmount, userWallet.walletAddress);
      console.log(`✓ Transaction successful: ${txnId}`);
    } catch (error) {
      console.error(`✗ Blockchain transaction failed:`, error);
      return res.status(500).json({
        success: false,
        message: "Failed to send USDT to wallet. Please try again later.",
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }

    // Update level status to Claimed in HybridPackage
    if (userLevel) {
      userLevel.status = "Claimed";
      userLevel.claimedAt = new Date();
      userLevel.txnId = txnId;
    } else {
      hybridPackage.levels.push({
        level: level,
        status: "Claimed",
        rewardAmount: rewardAmount,
        claimedAt: new Date(),
        txnId: txnId,
      });
    }
    await hybridPackage.save();

    // console.log(`\n💰 REWARD DISTRIBUTED`);
    // console.log(`Wallet Address: ${userWallet.walletAddress}`);
    // console.log(`Reward Amount: $${rewardAmount}`);
    // console.log(`Transaction ID: ${txnId}`);
    // console.log(`Level: ${level}`);
    // console.log(`========================================\n`);

    res.status(200).json({
      success: true,
      message: `Level ${level} reward claimed successfully`,
      data: {
        level: level,
        rewardAmount: rewardAmount,
        walletAddress: userWallet.walletAddress,
        txnId: txnId,
        currentMembers: membersAtLevel,
        requiredMembers: requiredMembers,
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
