// controllers/autopoolController.js
const User = require("../models/User");
const Autopool = require("../models/Autopool");
const Wallet = require("../models/Wallet");
const {
  performWalletTransaction,
} = require("../utils/performWalletTransaction");
const mongoose = require("mongoose");

const autopoolController = {
  async joinAutopool(req, res) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const userId = req.user.userId;
      const { walletType } = req.body; // Get wallet type from request body (USDTBalance or autopoolBalance)

      // Validate wallet type
      if (
        !walletType ||
        !["USDTBalance", "autopoolBalance"].includes(walletType)
      ) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message:
            "Invalid wallet type. Must be USDTBalance or autopoolBalance",
        });
      }

      // Get user details
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
      if (user.blockStatus || user.isRewardBlock) {
        await session.abortTransaction();
        session.endSession();
        return res.status(403).json({
          success: false,
          message: "Your account is blocked",
        });
      }

      // Get user's wallet
      const userWallet = await Wallet.findOne({ userId }).session(session);
      if (!userWallet) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "Wallet not found",
        });
      }

      // Check available balance based on selected wallet
      const walletBalance = userWallet[walletType];
      if (walletBalance < 50) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Your ${
            walletType === "USDTBalance" ? "USDT" : "Autopool"
          } balance is below $50`,
        });
      }

      // Check daily limit (maximum 3 transactions per day)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayCount = await Autopool.countDocuments({
        userId: userId,
        createdAt: {
          $gte: today,
          $lt: tomorrow,
        },
      }).session(session);

      if (todayCount >= 3) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message:
            "You have reached the maximum limit of autopool transactions. Please try tomorrow",
        });
      }

      // Check if this is the first user (no autopool entries exist)
      const totalAutopoolEntries = await Autopool.countDocuments({}).session(
        session
      );

      if (totalAutopoolEntries === 0) {
        // First user - create root entry
        const newAutopoolEntry = new Autopool({
          userId: userId,
          level: 1,
        });
        await newAutopoolEntry.save({ session });

        // Only deduct $50 from selected wallet, no reward to give
        await performWalletTransaction(
          userId,
          -50, // Negative for debit
          walletType,
          `Autopool Deposit - Root Entry (${
            walletType === "USDTBalance" ? "USDT" : "Autopool"
          } Wallet)`,
          "Completed",
          {
            metadata: {
              autopoolId: newAutopoolEntry._id.toString(),
              isRoot: true,
              walletUsed: walletType,
            },
          }
        );

        await session.commitTransaction();
        session.endSession();

        return res.status(200).json({
          success: true,
          message: "Autopool root entry created successfully",
          data: {
            autopoolId: newAutopoolEntry._id,
            position: "root",
            isFirstUser: true,
            walletUsed: walletType,
          },
        });
      }

      // Find the next available position in autopool tree
      const availableNode = await Autopool.findOne({
        rightNode: null,
      })
        .sort({ _id: 1 })
        .session(session);

      if (!availableNode) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "No available autopool position found",
        });
      }

      // Determine which column to fill (left or right)
      let updateField = {};
      let position = "";
      if (!availableNode.leftNode) {
        updateField = { leftNode: userId };
        position = "left";
      } else {
        updateField = { rightNode: userId };
        position = "right";
      }

      // Create new autopool entry for current user
      const newAutopoolEntry = new Autopool({
        userId: userId,
        level: (availableNode.level || 1) + 1,
      });
      await newAutopoolEntry.save({ session });

      // Update the available node with current user
      await Autopool.findByIdAndUpdate(availableNode._id, updateField, {
        session,
      });

      // Perform wallet transactions
      // 1. Deduct $50 from current user's selected wallet (Autopool Deposit)
      await performWalletTransaction(
        userId,
        -50, // Negative for debit
        walletType,
        `Autopool Deposit (${
          walletType === "USDTBalance" ? "USDT" : "Autopool"
        } Wallet)`,
        "Completed",
        {
          metadata: {
            autopoolId: newAutopoolEntry._id.toString(),
            parentId: availableNode.userId,
            walletUsed: walletType,
          },
        }
      );

      // 2. Credit $45 to the parent node user's autopool balance (Autopool Reward)
      // Always credit rewards to autopoolBalance regardless of which wallet was used for deposit
      await performWalletTransaction(
        availableNode.userId,
        45, // Positive for credit
        "autopoolBalance",
        "Autopool Reward",
        "Completed",
        {
          metadata: {
            fromUserId: userId,
            autopoolId: availableNode._id.toString(),
            depositWallet: walletType,
          },
        }
      );

      await session.commitTransaction();
      session.endSession();

      res.status(200).json({
        success: true,
        message: "Autopool purchased successfully",
        data: {
          autopoolId: newAutopoolEntry._id,
          position: position,
          parentUserId: availableNode.userId,
          level: newAutopoolEntry.level,
          walletUsed: walletType,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      console.error("Autopool error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },

  // Get user's autopool history
  async getAutopoolHistory(req, res) {
    try {
      const userId = req.user.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const autopools = await Autopool.find({ userId })
        .populate("leftNode rightNode", "userId name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Autopool.countDocuments({ userId });

      res.status(200).json({
        success: true,
        data: {
          autopools,
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
      console.error("Get autopool history error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },

  // Get autopool tree structure
  async getAutopoolTree(req, res) {
    try {
      const userId = req.user.userId;

      const userAutopool = await Autopool.findOne({ userId })
        .populate("leftNode rightNode", "userId name email")
        .sort({ createdAt: -1 });

      if (!userAutopool) {
        return res.status(404).json({
          success: false,
          message: "No autopool entry found",
        });
      }

      res.status(200).json({
        success: true,
        data: userAutopool,
      });
    } catch (error) {
      console.error("Get autopool tree error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },

  // Get autopool statistics
  async getAutopoolStats(req, res) {
    try {
      const userId = req.user.userId;

      const stats = await Autopool.aggregate([
        {
          $match: { userId },
        },
        {
          $group: {
            _id: null,
            totalEntries: { $sum: 1 },
            activeEntries: {
              $sum: {
                $cond: [{ $eq: ["$status", "active"] }, 1, 0],
              },
            },
            completedEntries: {
              $sum: {
                $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
              },
            },
          },
        },
      ]);

      // Get today's entries count
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const todayEntries = await Autopool.countDocuments({
        userId,
        createdAt: {
          $gte: today,
          $lt: tomorrow,
        },
      });

      const result =
        stats.length > 0
          ? stats[0]
          : {
              totalEntries: 0,
              activeEntries: 0,
              completedEntries: 0,
            };

      res.status(200).json({
        success: true,
        data: {
          ...result,
          todayEntries,
          remainingTodayLimit: Math.max(0, 3 - todayEntries),
        },
      });
    } catch (error) {
      console.error("Get autopool stats error:", error);
      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },
};

module.exports = autopoolController;
