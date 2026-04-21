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
const { enterMatrix } = require("./matrixController");

// Level Configuration based on International AutoPool
// divisions: 1 = single claim, 4 = split into 4 parts (levels 7-15)
const LEVEL_CONFIG = {
  1: { members: 2, percentage: 5, amount: 20, direct: 0, divisions: 1 },
  2: { members: 4, percentage: 5, amount: 40, direct: 0, divisions: 1 },
  3: { members: 8, percentage: 5, amount: 80, direct: 0, divisions: 1 },
  4: { members: 16, percentage: 5, amount: 160, direct: 0, divisions: 1 },
  5: { members: 32, percentage: 5, amount: 320, direct: 1, divisions: 1 },
  6: { members: 64, percentage: 5, amount: 640, direct: 1, divisions: 1 },
  7: { members: 128, percentage: 5, amount: 1280, direct: 2, divisions: 4 },
  8: { members: 256, percentage: 5, amount: 2560, direct: 2, divisions: 4 },
  9: { members: 512, percentage: 5, amount: 5120, direct: 3, divisions: 4 },
  10: { members: 1024, percentage: 5, amount: 10240, direct: 3, divisions: 4 },
  11: { members: 2048, percentage: 3, amount: 20460, direct: 4, divisions: 4 },
  12: { members: 4096, percentage: 3, amount: 40960, direct: 4, divisions: 4 },
  13: { members: 8192, percentage: 3, amount: 81920, direct: 5, divisions: 4 },
  14: { members: 16384, percentage: 3, amount: 163840, direct: 10, divisions: 4 },
  15: { members: 32768, percentage: 3, amount: 327680, direct: 15, divisions: 4 },
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
    const { packageAmount, walletType } = req.body;
    const liveRate = await getLiveRate();

    if (!userId || !packageAmount) {
      return res.status(400).json({
        success: false,
        message: "User ID and package amount are required",
      });
    }

    // Validate wallet type — only autopoolBalance or retopupBalance allowed
    const allowedWallets = ["autopoolBalance", "retopupBalance"];
    const selectedWallet = allowedWallets.includes(walletType) ? walletType : "autopoolBalance";

    const userWallet = await Wallet.findOne({ userId });
    if (!userWallet) {
      return res.status(400).json({
        success: false,
        message: "Wallet not found",
      });
    }

    if (userWallet[selectedWallet] < packageAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${selectedWallet === "retopupBalance" ? "Retopup" : "Autopool"} balance`,
        availableBalance: userWallet[selectedWallet],
        requiredAmount: packageAmount,
      });
    }

    await performWalletTransaction(
      userId,
      -packageAmount, // Negative for debit
      selectedWallet,
      `Retop up from ${selectedWallet === "retopupBalance" ? "Retopup" : "Autopool"} Wallet`,
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

    let newPosition = null;
    let parentPackageId = null;

    // PURE SEQUENTIAL PLACEMENT: Find the first empty slot in the binary tree
    const allPackages = await HybridPackage.find().select('position leftChildId rightChildId').lean();
    const existingPositions = new Set(allPackages.map(p => p.position));

    const highestPosition = allPackages.length > 0
      ? Math.max(...allPackages.map(p => p.position))
      : 0;

    // Build a position map for O(1) lookups
    const positionMap = {};
    allPackages.forEach(p => { positionMap[p.position] = p; });

    // Start from position 1 (root) if empty, otherwise position 2
    const startPosition = existingPositions.has(1) ? 2 : 1;

    for (let pos = startPosition; pos <= highestPosition + 2; pos++) {
      if (!existingPositions.has(pos)) {
        const parentPos = Math.floor(pos / 2);

        if (parentPos === 0) {
          // Root position
          newPosition = pos;
          parentPackageId = null;
          break;
        }

        const parentPkg = positionMap[parentPos];
        if (parentPkg) {
          const isLeftChild = (pos % 2 === 0);
          const slotIsEmpty = isLeftChild ? !parentPkg.leftChildId : !parentPkg.rightChildId;

          if (slotIsEmpty) {
            newPosition = pos;
            parentPackageId = parentPkg._id;
            break;
          }
        }
      }
    }

    // Fallback if no position found
    if (!newPosition) {
      newPosition = highestPosition + 1;
      const parentPos = Math.floor(newPosition / 2);
      const parentPkg = await HybridPackage.findOne({ position: parentPos });
      parentPackageId = parentPkg?._id || null;
    }

    // Create new hybrid package with fixed amount of 10 USDT
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
        parentPackage.leftChildId = newHybridPackage._id;
      } else {
        parentPackage.rightChildId = newHybridPackage._id;
      }

      await parentPackage.save();
    }

    // Save matrixLeft/matrixRight on sponsor's hybrid package and trigger matrix entry
    if (user.parentId) {
      try {
        const sponsorHybridPkg = await HybridPackage.findOne({ userId: user.parentId });

        if (sponsorHybridPkg) {
          if (!sponsorHybridPkg.matrixLeft) {
            sponsorHybridPkg.matrixLeft = userId;
            await sponsorHybridPkg.save();
          } else if (!sponsorHybridPkg.matrixRight) {
            sponsorHybridPkg.matrixRight = userId;
            await sponsorHybridPkg.save();

            // 2nd direct filled — sponsor enters matrix
            await enterMatrix(user.parentId);
          }
        }
      } catch (matrixError) {
        // Matrix entry failure should not block hybrid package creation
      }
    }

    res.status(201).json({
      success: true,
      message: "Hybrid package created successfully",
      data: newHybridPackage.toObject(),
    });
  } catch (err) {
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

    // Fetch user data to get parentId
    const user = await User.findOne({ userId }).select('parentId');

    // Fetch all Hybrid packages for the user using HybridPackage model
    const hybridPackages = await HybridPackage.find({
      userId,
    })
      .sort({ createdAt: -1 });

    // Calculate total investment in Hybrid packages (fixed 10 USDT per package)
    const totalHybridInvestment = hybridPackages.length * 10;

    // Count direct hybrid members: users with this userId as parentId who have hybrid packages
    let directHybridCount = 0;
    try {
      const directUsers = await User.find({ parentId: userId }).select('userId');
      const directUserIds = directUsers.map(u => u.userId);

      if (directUserIds.length > 0) {
        directHybridCount = await HybridPackage.countDocuments({
          userId: { $in: directUserIds }
        });
      }
    } catch (countError) {
      // Continue without direct count if error occurs
    }

    // Extract claimed levels from packages
    const claimedLevels = new Set();
    const levelDetails = [];

    if (hybridPackages.length > 0) {
      const primaryPackage = hybridPackages[0];

      if (primaryPackage.levels && Array.isArray(primaryPackage.levels)) {
        primaryPackage.levels.forEach((level) => {
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
    }

    // Add parentId to each package in the data array
    const packagesWithParentId = hybridPackages.map((pkg) => ({
      ...pkg.toObject(),
      parentId: user?.parentId || null, // Add parent userId
    }));

    res.status(200).json({
      success: true,
      message: "Hybrid packages retrieved successfully",
      count: hybridPackages.length,
      totalInvestment: totalHybridInvestment,
      directHybridCount, // Direct members with hybrid packages
      claimedLevels: Array.from(claimedLevels),
      levels: levelDetails,
      data: packagesWithParentId,
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

    // Fetch all users to get parentIds
    const allUsers = await User.find({}).select("userId parentId").lean();
    const userMap = {};
    allUsers.forEach((user) => {
      userMap[user.userId] = user.parentId;
    });

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
        parentId: userMap[pkg.userId] || null, // Add parentId from user data
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
    const { level, division } = req.body;

    if (!level || level < 1 || level > 15) {
      return res.status(400).json({
        success: false,
        message: "Invalid level. Level must be between 1 and 15.",
      });
    }

    const levelConfig = LEVEL_CONFIG[level];
    const hasDivisions = levelConfig.divisions > 1;

    if (hasDivisions) {
      if (!division || division < 1 || division > levelConfig.divisions) {
        return res.status(400).json({
          success: false,
          message: `Level ${level} requires a division (1-${levelConfig.divisions}).`,
        });
      }
    }

    const divisionValue = hasDivisions ? division : null;

    // ATOMIC LOCK: Use findOneAndUpdate to prevent race condition (TOCTOU fix)
    // This atomically checks that no Claimed/Processing entry exists and adds a Processing entry.
    // Sort ascending so we always target the user's primary (earliest) package — subsequent
    // reads must come from the same package, otherwise claims go missing for users with
    // multiple packages (original + retopups).
    const lockResult = await HybridPackage.findOneAndUpdate(
      {
        userId,
        levels: {
          $not: {
            $elemMatch: {
              level,
              division: divisionValue,
              status: { $in: ["Claimed", "Processing"] },
            },
          },
        },
      },
      {
        $push: {
          levels: {
            level,
            division: divisionValue,
            status: "Processing",
            rewardAmount: 0,
            achievedAt: new Date(),
          },
        },
      },
      { new: true, sort: { createdAt: 1 } }
    );

    if (!lockResult) {
      const label = hasDivisions ? `Level ${level} Part ${division}` : `Level ${level}`;
      return res.status(400).json({
        success: false,
        message: `${label} has already been claimed or is being processed`,
      });
    }

    const packageId = lockResult._id;

    // For divided levels, ensure previous division is claimed first (sequential claiming)
    if (hasDivisions && division > 1) {
      const prevDivision = lockResult.levels.find(
        (l) => l.level === level && l.division === (division - 1) && l.status === "Claimed"
      );
      if (!prevDivision) {
        await HybridPackage.findByIdAndUpdate(
          packageId,
          { $pull: { levels: { level, division: divisionValue, status: "Processing" } } }
        );
        return res.status(400).json({
          success: false,
          message: `You must claim Level ${level} Part ${division - 1} before claiming Part ${division}.`,
        });
      }
    }

    const user = await User.findOne({ userId });
    if (!user || !user.walletAddress) {
      await HybridPackage.findByIdAndUpdate(
        packageId,
        { $pull: { levels: { level, division: divisionValue, status: "Processing" } } }
      );
      return res.status(400).json({
        success: false,
        message: "User wallet address not found",
      });
    }

    // Check direct referral requirement for levels > 4
    if (level > 4 && levelConfig.direct > 0) {
      try {
        const directUsers = await User.find({ parentId: userId }).select("userId");
        const directUserIds = directUsers.map((u) => u.userId);
        const directCount = await HybridPackage.countDocuments({ userId: { $in: directUserIds } });
        if (directCount < levelConfig.direct) {
          await HybridPackage.findByIdAndUpdate(
            packageId,
            { $pull: { levels: { level, division: divisionValue, status: "Processing" } } }
          );
          return res.status(400).json({
            success: false,
            message: `Insufficient direct hybrid referrals. Level ${level} requires ${levelConfig.direct} direct members with a hybrid package, but you have ${directCount}.`,
          });
        }
      } catch (error) {
        await HybridPackage.findByIdAndUpdate(
          packageId,
          { $pull: { levels: { level, division: divisionValue, status: "Processing" } } }
        );
        return res.status(500).json({
          success: false,
          message: "Error verifying direct hybrid referral requirement",
          error: error.message,
        });
      }
    }

    // Calculate reward and payment split
    const totalReward = (levelConfig.amount * levelConfig.percentage) / 100;
    const finalRewardAmount = hasDivisions ? totalReward / levelConfig.divisions : totalReward;

    let cryptoAmount;
    let retopupAmount = 0;
    if (level >= 1 && level <= 4) {
      cryptoAmount = finalRewardAmount;
    } else {
      // Levels 5-15: 50% crypto + 30% retopup
      cryptoAmount = (finalRewardAmount * 50) / 100;
      retopupAmount = (finalRewardAmount * 30) / 100;
    }

    // STEP 1: Send crypto. If this fails, nothing has moved — revert Processing and user retries.
    let txnHash = null;
    try {
      txnHash = await makeCryptoTransaction(cryptoAmount, user.walletAddress);
    } catch (paymentError) {
      await HybridPackage.findByIdAndUpdate(
        packageId,
        { $pull: { levels: { level, division: divisionValue, status: "Processing" } } }
      );
      return res.status(500).json({
        success: false,
        message: "Failed to process crypto payment",
        error: paymentError.message,
      });
    }

    // STEP 2: Crypto has moved — finalize Claimed immediately so the user cannot double-claim.
    // Point of no return: secondary bookkeeping failures below must NOT roll back Claimed.
    await HybridPackage.findOneAndUpdate(
      {
        _id: packageId,
        levels: {
          $elemMatch: { level, division: divisionValue, status: "Processing" },
        },
      },
      {
        $set: {
          "levels.$.status": "Claimed",
          "levels.$.claimedAt": new Date(),
          "levels.$.rewardAmount": finalRewardAmount,
          "levels.$.txnHash": txnHash,
        },
      }
    );

    // STEP 3: Retopup credit (best-effort). Claim is already Claimed — on failure we log for
    // manual admin follow-up rather than rolling back.
    if (retopupAmount > 0) {
      const remark = hasDivisions
        ? `Level ${level} Part ${division} reward (30% retopup distribution)`
        : `Level ${level} reward (30% retopup distribution)`;
      try {
        await performWalletTransaction(userId, retopupAmount, "retopupBalance", remark, "Completed");
      } catch (retopupError) {
        console.error(
          `[MANUAL-ACTION-REQUIRED] Retopup credit failed after successful claim ` +
          `(user=${userId}, level=${level}, division=${divisionValue}, amount=${retopupAmount} USDT, txnHash=${txnHash}). ` +
          `Credit retopupBalance manually.`,
          retopupError
        );
      }
    }

    res.status(200).json({
      success: true,
      message: "Reward claimed successfully",
      data: {
        level,
        division: divisionValue,
        rewardAmount: finalRewardAmount,
        txnHash: txnHash || null,
      },
    });
  } catch (error) {
    console.error("[CLAIM-BE] Error claiming reward:", error);
    res.status(500).json({
      success: false,
      message: "Failed to claim reward",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getMatrixTreeFromHybrid = async (req, res) => {
  try {
    const userId = req.user.userId;

    const currentUser = await User.findOne(
      { userId },
      { userId: 1, name: 1, parentId: 1, createdAt: 1 }
    ).lean();

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Load all hybrid packages once — we need userId + matrix slot fields
    const hybridPackages = await HybridPackage.find(
      {},
      { userId: 1, matrixLeft: 1, matrixRight: 1 }
    ).lean();

    const hybridSet = new Set();
    const matrixByParent = new Map(); // parent userId -> Set of (matrixLeft/matrixRight) userIds
    hybridPackages.forEach((p) => {
      hybridSet.add(p.userId);
      if (!matrixByParent.has(p.userId)) matrixByParent.set(p.userId, new Set());
      const slots = matrixByParent.get(p.userId);
      if (p.matrixLeft) slots.add(p.matrixLeft);
      if (p.matrixRight) slots.add(p.matrixRight);
    });

    const hybridUsers = await User.find(
      { userId: { $in: [...hybridSet] } },
      { userId: 1, name: 1, parentId: 1, createdAt: 1 }
    ).lean();

    const childrenByParent = new Map();
    hybridUsers.forEach((u) => {
      if (!childrenByParent.has(u.parentId)) childrenByParent.set(u.parentId, []);
      childrenByParent.get(u.parentId).push(u);
    });

    const visited = new Set();
    const buildNode = (user, isRoot = false) => {
      if (visited.has(user.userId)) return null;
      visited.add(user.userId);

      const myMatrix = matrixByParent.get(user.userId) || new Set();
      const childUsers = childrenByParent.get(user.userId) || [];
      const children = childUsers
        .map((c) => {
          const node = buildNode(c);
          if (node) node.isMatrixMember = myMatrix.has(c.userId);
          return node;
        })
        .filter(Boolean);

      return {
        userId: user.userId,
        name: user.name || null,
        parentId: user.parentId || null,
        isCurrentUser: isRoot,
        isHybrid: hybridSet.has(user.userId),
        isMatrixMember: false,
        createdAt: user.createdAt,
        children,
      };
    };

    const tree = buildNode(currentUser, true);

    res.status(200).json({
      success: true,
      message: "Team tree retrieved successfully",
      data: tree,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch team tree",
      error: error.message,
    });
  }
};
