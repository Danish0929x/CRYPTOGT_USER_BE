// controllers/hybridAutopoolController.js
const HybridAutopool = require("../models/HybridAutopool");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const {
  performWalletTransaction,
} = require("../utils/performWalletTransaction");
const mongoose = require("mongoose");

// Level configuration
const LEVEL_CONFIG = {
  1: { members: 2, earning: 1, percentage: 5, directRequired: 0 },
  2: { members: 4, earning: 2, percentage: 5, directRequired: 0 },
  3: { members: 8, earning: 4, percentage: 5, directRequired: 0 },
  4: { members: 16, earning: 8, percentage: 5, directRequired: 0 },
  5: { members: 32, earning: 16, percentage: 5, directRequired: 1 },
  6: { members: 64, earning: 32, percentage: 5, directRequired: 1 },
  7: { members: 128, earning: 64, percentage: 5, directRequired: 2 },
  8: { members: 256, earning: 128, percentage: 5, directRequired: 2 },
  9: { members: 512, earning: 256, percentage: 5, directRequired: 3 },
  10: { members: 1024, earning: 512, percentage: 5, directRequired: 3 },
  11: { members: 2048, earning: 614, percentage: 3, directRequired: 4 },
  12: { members: 4096, earning: 1228, percentage: 3, directRequired: 4 },
  13: { members: 8192, earning: 2457, percentage: 3, directRequired: 5 },
  14: { members: 16384, earning: 4915, percentage: 3, directRequired: 10 },
  15: { members: 32768, earning: 9830, percentage: 3, directRequired: 15 },
};

const hybridAutopoolController = {
  // Join Hybrid Autopool
  async joinHybridAutopool(req, res) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userId = req.user.userId;
      const { walletType } = req.body;

      // Validate wallet type
      if (!walletType || !["USDTBalance", "autopoolBalance"].includes(walletType)) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid wallet type. Must be USDTBalance or autopoolBalance",
        });
      }

      // Check user exists
      const user = await User.findOne({ userId }).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check if user is blocked
      if (user.blockStatus) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: "Your account is blocked",
        });
      }

      // Check wallet balance
      const userWallet = await Wallet.findOne({ userId }).session(session);
      if (!userWallet) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Wallet not found",
        });
      }

      const walletBalance = userWallet[walletType];
      if (walletBalance < 10) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Your ${walletType === "USDTBalance" ? "USDT" : "Autopool"} balance is below $10`,
        });
      }

      // Find next available position
      const lastEntry = await HybridAutopool.findOne()
        .sort({ position: -1 })
        .session(session);

      const newPosition = lastEntry ? lastEntry.position + 1 : 1;
      const parentPosition = newPosition === 1 ? 0 : Math.floor(newPosition / 2);

      // Deduct $10 from wallet
      await performWalletTransaction(
        userId,
        -10,
        walletType,
        `Hybrid Autopool Entry - Position ${newPosition}`,
        "Completed",
        {
          metadata: {
            position: newPosition,
            parentPosition: parentPosition,
            walletUsed: walletType,
          },
        }
      );

      // Get user's direct referral count (from User model)
      const directReferrals = await User.countDocuments({
        parentId: userId,
      }).session(session);

      // Create new hybrid autopool entry
      const newEntry = new HybridAutopool({
        userId,
        position: newPosition,
        parentPosition: parentPosition,
        directReferrals: directReferrals,
        walletUsed: walletType,
      });
      await newEntry.save({ session });

      // Update parent's child references
      if (parentPosition > 0) {
        const parent = await HybridAutopool.findOne({
          position: parentPosition,
        }).session(session);

        if (parent) {
          const leftChildPos = parentPosition * 2;
          if (newPosition === leftChildPos) {
            parent.leftChildPosition = newPosition;
          } else {
            parent.rightChildPosition = newPosition;
          }
          await parent.save({ session });
        }
      }

      // Check and distribute upline bonuses
      await checkAndDistributeUplineBonuses(newPosition, session);

      await session.commitTransaction();
      session.endSession();

      res.status(200).json({
        success: true,
        message: "Successfully joined Hybrid Autopool",
        data: {
          position: newPosition,
          parentPosition: parentPosition,
          walletUsed: walletType,
          entryFee: 10,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      console.error("Join Hybrid Autopool error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  },

  // Get user's hybrid autopool history
  // If `position` query param is provided, returns history for that position's subtree.
  // Otherwise, will try to return history for the current user's position (their subtree).
  // Falls back to items owned by the user if the user has no HybridAutopool entry.
  async getHybridAutopoolHistory(req, res) {
    try {
      const userId = req.user.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // Determine starting position: optional ?position=123, or current user's position
      let startPosition = null;
      if (req.query.position) {
        startPosition = parseInt(req.query.position);
      } else {
        const myNode = await HybridAutopool.findOne({ userId }).lean();
        if (myNode && myNode.position) {
          startPosition = myNode.position;
        }
      }

      // If we have a startPosition, gather all descendant positions (BFS)
      if (startPosition) {
        const positions = [];
        const queue = [startPosition];

        while (queue.length > 0) {
          const pos = queue.shift();
          positions.push(pos);

          const node = await HybridAutopool.findOne({ position: pos }).lean();
          if (!node) continue;

          if (node.leftChildPosition) queue.push(node.leftChildPosition);
          if (node.rightChildPosition) queue.push(node.rightChildPosition);
        }

        const total = await HybridAutopool.countDocuments({ position: { $in: positions } });
        const entries = await HybridAutopool.find({ position: { $in: positions } })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean();

        return res.status(200).json({
          success: true,
          data: {
            entries: entries,
            pagination: {
              currentPage: page,
              totalPages: Math.ceil(total / limit),
              totalRecords: total,
              hasNext: page < Math.ceil(total / limit),
              hasPrev: page > 1,
            },
          },
        });
      }

      // Fallback: no position found and user has no node — return entries owned by userId
      const entries = await HybridAutopool.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

      const total = await HybridAutopool.countDocuments({ userId });

      res.status(200).json({
        success: true,
        data: {
          entries: entries,
          pagination: {
            currentPage: page,
            totalPages: Math.ceil(total / limit),
            totalRecords: total,
            hasNext: page < Math.ceil(total / limit),
            hasPrev: page > 1,
          },
        },
      });
    } catch (error) {
      console.error("Get Hybrid Autopool History error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  },

  // Get hybrid autopool statistics
  async getHybridAutopoolStats(req, res) {
    try {
      const userId = req.user.userId;

      const entries = await HybridAutopool.find({ userId }).lean();

      if (entries.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            totalEntries: 0,
            totalInvestment: 0,
            totalEarnings: 0,
            highestLevel: 0,
            completedLevels: [],
            blockedLevels: [],
          },
        });
      }

      const totalEntries = entries.length;
      const totalInvestment = totalEntries * 10;
      let totalEarnings = 0;
      let highestLevel = 0;
      const allCompletedLevels = [];
      const allBlockedLevels = [];

      entries.forEach((entry) => {
        totalEarnings += entry.earnings.total || 0;
        if (entry.currentLevel > highestLevel) {
          highestLevel = entry.currentLevel;
        }
        allCompletedLevels.push(...entry.completedLevels);
        allBlockedLevels.push(...entry.blocked);
      });

      res.status(200).json({
        success: true,
        data: {
          totalEntries,
          totalInvestment,
          totalEarnings,
          highestLevel,
          completedLevels: [...new Set(allCompletedLevels)].sort((a, b) => a - b),
          blockedLevels: [...new Set(allBlockedLevels)].sort((a, b) => a - b),
        },
      });
    } catch (error) {
      console.error("Get Hybrid Autopool Stats error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  },

  // Get tree view for a specific position
  async getHybridAutopoolTree(req, res) {
    try {
      const { position } = req.query;

      if (!position) {
        return res.status(400).json({
          success: false,
          message: "Position query parameter is required",
        });
      }

      const node = await HybridAutopool.findOne({
        position: parseInt(position),
      }).lean();

      if (!node) {
        return res.status(404).json({
          success: false,
          message: "Position not found",
        });
      }

      // Get children
      const leftChild = node.leftChildPosition
        ? await HybridAutopool.findOne({ position: node.leftChildPosition }).lean()
        : null;

      const rightChild = node.rightChildPosition
        ? await HybridAutopool.findOne({ position: node.rightChildPosition }).lean()
        : null;

      res.status(200).json({
        success: true,
        data: {
          node: node,
          leftChild: leftChild,
          rightChild: rightChild,
        },
      });
    } catch (error) {
      console.error("Get Hybrid Autopool Tree error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Internal Server Error",
      });
    }
  },
};

// Helper function: Check and distribute upline bonuses
async function checkAndDistributeUplineBonuses(childPosition, session) {
  let currentPos = Math.floor(childPosition / 2);
  let depth = 1;

  while (currentPos >= 1 && depth <= 15) {
    const upline = await HybridAutopool.findOne({ position: currentPos }).session(
      session
    );

    if (!upline) {
      break;
    }

    // Skip if position is not active
    if (upline.status !== 'active') {
      currentPos = Math.floor(currentPos / 2);
      depth++;
      continue;
    }

    // Calculate new level for this upline
    const newLevel = await calculateNodeLevel(currentPos, session);

    // If level increased, distribute bonuses for all new levels
    if (newLevel > upline.currentLevel) {
      for (let level = upline.currentLevel + 1; level <= newLevel; level++) {
        if (!upline.completedLevels.includes(level)) {
          await distributeLevelBonus(upline, level, session);
        }
      }

      upline.currentLevel = newLevel;
      await upline.save({ session });
    }

    currentPos = Math.floor(currentPos / 2);
    depth++;
  }
}

// Helper function: Calculate node level
async function calculateNodeLevel(position, session) {
  const leftPos = position * 2;
  const rightPos = position * 2 + 1;

  const [leftChild, rightChild] = await Promise.all([
    HybridAutopool.findOne({ position: leftPos }).session(session),
    HybridAutopool.findOne({ position: rightPos }).session(session),
  ]);

  // No children or only one child → Level 0
  if (!leftChild || !rightChild) {
    return 0;
  }

  // Both children exist → Level = 1 + min(left level, right level)
  const leftLevel = leftChild.currentLevel;
  const rightLevel = rightChild.currentLevel;

  return 1 + Math.min(leftLevel, rightLevel);
}

// Helper function: Distribute level bonus
async function distributeLevelBonus(upline, level, session) {
  const config = LEVEL_CONFIG[level];

  if (!config) return;

  const directRequired = config.directRequired;
  const earning = config.earning;

  // Check direct referral requirement
  if (upline.directReferrals < directRequired) {
    // Blocked - create transaction record
    const blockedTx = new Transaction({
      userId: upline.userId,
      walletName: "USDTBalance",
      creditedAmount: 0,
      debitedAmount: 0,
      transactionRemark: `Hybrid Autopool Level ${level} Bonus - BLOCKED (Need ${directRequired} Direct Referrals)`,
      status: "Blocked",
      metadata: {
        level: level,
        earning: earning,
        directRequired: directRequired,
        currentDirect: upline.directReferrals,
        position: upline.position,
      },
    });
    await blockedTx.save({ session });

    // Track blocked level
    if (!upline.blocked.includes(level)) {
      upline.blocked.push(level);
    }

    return;
  }

  // Qualified - give bonus
  await performWalletTransaction(
    upline.userId,
    earning,
    "USDTBalance",
    `Hybrid Autopool Level ${level} Bonus (Position: ${upline.position})`,
    "Completed",
    {
      metadata: {
        level: level,
        percentage: config.percentage,
        position: upline.position,
      },
    }
  );

  // Update earnings
  upline.earnings[`level${level}`] = earning;
  upline.earnings.total += earning;
  upline.completedLevels.push(level);
}

module.exports = hybridAutopoolController;
