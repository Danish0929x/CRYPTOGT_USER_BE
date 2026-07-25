const Package = require("../models/Packages");
const HybridPackage = require("../models/HybridPackage");
const MatrixPackage = require("../models/MatrixPackage");
const Transaction = require("../models/Transaction");
const { distributeDirectBonus } = require("../functions/directDistributeBonus");
const getLiveRate = require("../utils/liveRateUtils");
const Wallet = require("../models/Wallet");
const { performWalletTransaction } = require("../utils/performWalletTransaction");
const { handleDirectMembers } = require("../functions/checkProductVoucher");
const User = require("../models/User");
const Pin = require("../models/Pin");
const { sendHybridAmount } = require("../functions/sendHybridAmount");
const { makeCryptoTransaction } = require("../utils/makeUSDTCryptoTransaction");
const { enterMatrix } = require("./matrixController");

// Allowed Buy amounts (must mirror frontend CreatePackage.js)
const LEADER_AMOUNTS = [50, 100, 200];
const INVESTOR_AMOUNTS = [250, 500, 1000, 2000, 5000];
const ALLOWED_BUY_AMOUNTS = new Set([...LEADER_AMOUNTS, ...INVESTOR_AMOUNTS]);

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

    const amountNum = Number(packageAmount);
    if (!ALLOWED_BUY_AMOUNTS.has(amountNum)) {
      return res.status(400).json({
        success: false,
        message: `Invalid package amount. Allowed: Leader (${LEADER_AMOUNTS.map(a => `$${a}`).join(", ")}), Investor (${INVESTOR_AMOUNTS.map(a => `$${a}`).join(", ")}).`,
      });
    }

    const packageType = LEADER_AMOUNTS.includes(amountNum) ? "Leader" : "Investor";

    // Create new package according to model
    const newPackage = new Package({
      userId,
      packageType,
      cgtCoin: parseFloat((amountNum / liveRate).toFixed(5)),
      packageAmount: amountNum,
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

    const amountNum = Number(packageAmount);
    if (!ALLOWED_BUY_AMOUNTS.has(amountNum)) {
      return res.status(400).json({
        success: false,
        message: `Invalid package amount. Allowed: Leader (${LEADER_AMOUNTS.map(a => `$${a}`).join(", ")}), Investor (${INVESTOR_AMOUNTS.map(a => `$${a}`).join(", ")}).`,
      });
    }

    // Validate wallet type — autopoolBalance, retopupBalance, or USDTBalance allowed
    const WALLET_LABELS = {
      autopoolBalance: "Autopool",
      retopupBalance: "Retopup",
      USDTBalance: "USDT",
    };
    const selectedWallet = WALLET_LABELS[walletType] ? walletType : "autopoolBalance";
    const walletLabel = WALLET_LABELS[selectedWallet];

    const userWallet = await Wallet.findOne({ userId });
    if (!userWallet) {
      return res.status(400).json({
        success: false,
        message: "Wallet not found",
      });
    }

    if (userWallet[selectedWallet] < amountNum) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${walletLabel} balance`,
        availableBalance: userWallet[selectedWallet],
        requiredAmount: amountNum,
      });
    }

    await performWalletTransaction(
      userId,
      -amountNum, // Negative for debit
      selectedWallet,
      `Retop up from ${walletLabel} Wallet`,
      "Completed"
    );

    const packageType = LEADER_AMOUNTS.includes(amountNum) ? "Leader" : "Investor";

    // Create new package according to model
    const newPackage = new Package({
      userId,
      packageType,
      cgtCoin: parseFloat((amountNum / liveRate).toFixed(5)),
      packageAmount: amountNum,
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
  let claimedPin = null; // tracked for rollback if creation fails
  try {
    const userId = req.user.userId;
    const { pin } = req.body;

    // A valid activation pin (generated by admin) is now required instead of an
    // on-chain USDT payment. The package amount comes from the pin's packageType.
    if (!pin) {
      return res.status(400).json({
        success: false,
        message: "Activation pin is required.",
      });
    }

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

    // Atomically claim the pin: only succeeds if it exists and is not yet
    // activated. This makes a pin single-use and prevents double-activation races.
    claimedPin = await Pin.findOneAndUpdate(
      { pin: String(pin), activated: false },
      { $set: { activated: true, usedBy: userId, usedAt: new Date() } },
      { new: true }
    );

    if (!claimedPin) {
      return res.status(400).json({
        success: false,
        message: "Invalid or already-used pin.",
      });
    }

    const hybridAmount = claimedPin.packageType; // 10 | 50 | 100
    const txnId = `PIN-${claimedPin.pin}`;

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

    // Create new hybrid package with the specified amount
    const newHybridPackage = new HybridPackage({
      userId,
      position: newPosition,
      parentPackageId,
      txnId: txnId || null,
      amount: hybridAmount,
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

    // $0 pins create a package but do NOT reward the sponsor in any way:
    // they don't fill the sponsor's matrix (so no upward matrix rewards) and
    // grant no direct 25% bonus. Both are gated on a positive amount.
    const isFreePackage = hybridAmount <= 0;

    // Record the sponsor's first two direct referrals (informational — feeds the
    // hybrid matrix tree display). This no longer triggers matrix entry; entry is
    // now balance-driven (see the matrix-entry block below).
    if (user.parentId && !isFreePackage) {
      try {
        const sponsorHybridPkg = await HybridPackage.findOne({ userId: user.parentId });

        if (sponsorHybridPkg) {
          if (!sponsorHybridPkg.matrixLeft) {
            sponsorHybridPkg.matrixLeft = userId;
            await sponsorHybridPkg.save();
          } else if (!sponsorHybridPkg.matrixRight) {
            sponsorHybridPkg.matrixRight = userId;
            await sponsorHybridPkg.save();
          }
        }
      } catch (matrixError) {
        // Slot recording failure should not block hybrid package creation
      }
    }

    // Credit 25% of hybrid package amount to parent's hybrid balance
    if (user.parentId && !isFreePackage) {
      try {
        const parentWallet = await Wallet.findOne({ userId: user.parentId });
        if (parentWallet) {
          const parentBonus = hybridAmount * 0.25; // 25% of the hybrid amount
          parentWallet.hybridBalance += parentBonus;
          await parentWallet.save();
        }
      } catch (walletError) {
        console.error("Error crediting parent hybrid balance:", walletError);
        // Don't block package creation if wallet credit fails
      }
    }

    // Balance-driven matrix entry: once the parent's accumulated hybrid bonus
    // reaches the $5 HM1-P1 entry fee (e.g. one $50 direct → $12.5, or several
    // smaller directs adding up), deduct $5 from hybridBalance and place them in
    // the matrix. Charged exactly once: we skip if already placed, and refund the
    // $5 if placement didn't actually happen (already-in / concurrent race — the
    // unique userId+hm+part index makes enterMatrix idempotent).
    const MATRIX_ENTRY_FEE = 5;
    if (user.parentId && !isFreePackage) {
      try {
        const alreadyInMatrix = await MatrixPackage.findOne({
          userId: user.parentId,
          hm: 1,
          part: 1,
        });

        if (!alreadyInMatrix) {
          const parentWallet = await Wallet.findOne({ userId: user.parentId });
          if (parentWallet && parentWallet.hybridBalance >= MATRIX_ENTRY_FEE) {
            // Deduct first (logged as a Transaction), then place.
            await performWalletTransaction(
              user.parentId,
              -MATRIX_ENTRY_FEE,
              "hybridBalance",
              "Matrix Entry Fee (HM1-P1) - $5",
              "Completed"
            );

            const entryResult = await enterMatrix(user.parentId);
            if (!entryResult || !entryResult.success) {
              // Placement did not happen — refund the entry fee.
              await performWalletTransaction(
                user.parentId,
                MATRIX_ENTRY_FEE,
                "hybridBalance",
                "Matrix Entry Fee refund (entry not placed)",
                "Completed"
              );
            }
          }
        }
      } catch (matrixEntryError) {
        console.error("Error during balance-driven matrix entry:", matrixEntryError);
        // Never block hybrid package creation on matrix entry.
      }
    }

    res.status(201).json({
      success: true,
      message: "Hybrid package created successfully",
      data: newHybridPackage.toObject(),
    });
  } catch (err) {
    // Release the pin so it can be reused if package creation failed after claiming.
    if (claimedPin) {
      try {
        await Pin.findByIdAndUpdate(claimedPin._id, {
          $set: { activated: false, usedBy: null, usedAt: null },
        });
      } catch (rollbackErr) {
        console.error("Error releasing pin after failure:", rollbackErr);
      }
    }
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

    // Calculate total investment in Hybrid packages (sum of actual amounts)
    const totalHybridInvestment = hybridPackages.reduce((sum, pkg) => sum + (pkg.amount || 10), 0);

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
      .select("userId status createdAt amount");

    // Get user details for display
    const userDetails = await User.find({ userId: { $in: directUserIds } }).select("userId name");
    const userMap = {};
    userDetails.forEach((user) => {
      userMap[user.userId] = user.name;
    });

    // Calculate total investment in Direct Hybrid packages (sum of actual amounts)
    const totalDirectHybridInvestment = directHybridPackages.reduce((sum, pkg) => sum + (pkg.amount || 10), 0);

    res.status(200).json({
      success: true,
      message: "Direct hybrid packages retrieved successfully",
      count: directHybridPackages.length,
      totalInvestment: totalDirectHybridInvestment,
      data: directHybridPackages.map((pkg) => ({
        id: pkg._id,
        userId: pkg.userId,
        userName: userMap[pkg.userId] || "N/A",
        amount: pkg.amount || 10,
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

    // Pending Transaction. The levels entry stays in "Processing" until admin acts.
    // Admin Accept sends crypto + credits retopup + flips entry to "Claimed".
    // Admin Reject $pulls the entry so the user can retry.
    const label = hasDivisions ? `Level ${level} Part ${division}` : `Level ${level}`;
    const pendingTx = new Transaction({
      userId,
      walletName: "USDTBalance",
      creditedAmount: 0,
      debitedAmount: 0,
      transactionRemark: `${label} reward - $${finalRewardAmount} (Awaiting admin approval)`,
      status: "Pending",
      toAddress: user.walletAddress,
      metadata: {
        withdrawalType: "LevelClaim",
        hybridPackageId: String(packageId),
        level,
        division: divisionValue,
        finalRewardAmount,
        cryptoAmount,
        retopupAmount,
      },
    });
    await pendingTx.save();

    return res.status(200).json({
      success: true,
      message: "Claim request submitted. Awaiting admin approval.",
      data: {
        transactionId: pendingTx._id,
        level,
        division: divisionValue,
        finalRewardAmount,
        status: "Pending",
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

exports.getHybridSalaryReward = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get all direct children of current user
    const directChildren = await User.find(
      { parentId: userId },
      { userId: 1, name: 1, createdAt: 1 }
    ).lean();

    if (!directChildren || directChildren.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No direct referrals found",
        data: {
          strongLegs: [],
          allLegs: [],
        },
      });
    }

    // For each direct child, calculate total hybrid investment in their downline
    const legsWithInvestment = await Promise.all(
      directChildren.map(async (child) => {
        // Get all descendants of this child (including the child itself)
        const descendantData = await User.aggregate([
          { $match: { userId: child.userId } },
          {
            $graphLookup: {
              from: "users",
              startWith: "$userId",
              connectFromField: "userId",
              connectToField: "parentId",
              as: "descendants",
              maxDepth: 100,
            },
          },
          {
            $project: {
              allUserIds: {
                $concatArrays: [
                  [{ userId: "$userId" }],
                  {
                    $map: {
                      input: "$descendants",
                      as: "desc",
                      in: { userId: "$$desc.userId" },
                    },
                  },
                ],
              },
            },
          },
        ]);

        const allUserIds = descendantData[0]?.allUserIds?.map((u) => u.userId) || [
          child.userId,
        ];

        // Only count packages with a start date on/after 1st July 2026.
        const packageCutoffDate = new Date("2026-07-01T00:00:00.000Z");

        // Sum hybrid packages for this child and all their descendants
        const investmentResult = await HybridPackage.aggregate([
          {
            $match: {
              userId: { $in: allUserIds },
              status: { $in: ["Active", "active"] },
              createdAt: { $gte: packageCutoffDate },
            },
          },
          {
            $group: {
              _id: null,
              totalInvestment: { $sum: "$amount" },
            },
          },
        ]);

        // Sum regular packages (Leader/Investor/Hybrid buys) for the same
        // downline. Count everything except still-pending "Requested" records.
        const packageResult = await Package.aggregate([
          {
            $match: {
              userId: { $in: allUserIds },
              status: { $ne: "Requested" },
              startDate: { $gte: packageCutoffDate },
            },
          },
          {
            $group: {
              _id: null,
              totalInvestment: { $sum: "$packageAmount" },
            },
          },
        ]);

        const hybridInvestment = investmentResult[0]?.totalInvestment || 0;
        const packageInvestment = packageResult[0]?.totalInvestment || 0;
        const totalHybridInvestment = hybridInvestment + packageInvestment;

        // Count direct children of this child
        const directChildCount = await User.countDocuments({
          parentId: child.userId,
        });

        return {
          userId: child.userId,
          name: child.name || "Unknown",
          totalHybridInvestment,
          directChildCount,
          joinDate: child.createdAt,
        };
      })
    );

    // Sort by total investment descending
    const sortedLegs = legsWithInvestment.sort(
      (a, b) => b.totalHybridInvestment - a.totalHybridInvestment
    );

    // Strong leg = highest investment
    // Weak leg = sum of all remaining members
    const strongLeg = sortedLegs[0];
    const remainingLegs = sortedLegs.slice(1);
    const weakLegTotalInvestment = remainingLegs.reduce(
      (sum, leg) => sum + leg.totalHybridInvestment,
      0
    );
    const weakLegDirectChildCount = remainingLegs.reduce(
      (sum, leg) => sum + leg.directChildCount,
      0
    );

    const strongLegs = [
      strongLeg,
      {
        userId: "combined",
        name: "Weak Leg (Combined)",
        totalHybridInvestment: weakLegTotalInvestment,
        directChildCount: weakLegDirectChildCount,
        joinDate: new Date(),
      },
    ];

    res.status(200).json({
      success: true,
      message: "Hybrid salary reward data fetched successfully",
      data: {
        strongLegs,
        allLegs: sortedLegs,
      },
    });
  } catch (error) {
    console.error("Error fetching hybrid salary reward:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch hybrid salary reward data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
