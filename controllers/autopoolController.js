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
      const userId = req.user.userId; // This is "CGT8647"
      const { walletType } = req.body;

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

      // FIXED: Query by userId field instead of _id
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

      // FIXED: Get user's wallet by userId field
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
          status: "active",
        });
        await newAutopoolEntry.save({ session });

        // Only deduct $50 from selected wallet, no reward to give
        await performWalletTransaction(
          userId,
          -50,
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

      // Find the next available position in autopool tree (only active entries)
      const availableNode = await Autopool.findOne({
        $or: [
          { leftNode: null },
          { rightNode: null }
        ],
        status: "active"
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

      // Check if this will complete the parent node (both left and right filled)
      const willComplete = availableNode.leftNode && !availableNode.rightNode && position === "right";
      if (willComplete) {
        updateField.status = "completed";
        updateField.completedAt = new Date();
      }

      // Create new autopool entry for current user
      const newAutopoolEntry = new Autopool({
        userId: userId,
        level: (availableNode.level || 1) + 1,
        status: "active",
      });
      await newAutopoolEntry.save({ session });

      // Update the available node with current user
      await Autopool.findByIdAndUpdate(availableNode._id, updateField, {
        session,
      });

      // Perform wallet transactions
      await performWalletTransaction(
        userId,
        -50,
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

      await performWalletTransaction(
        availableNode.userId,
        45,
        "USDTBalance",
        "Autopool Reward",
        "Completed",
        {
          metadata: {
            fromUserId: userId,
            autopoolId: availableNode._id.toString(),
            depositWallet: walletType,
            parentCompleted: willComplete,
          },
        }
      );

      await session.commitTransaction();
      session.endSession();

      res.status(200).json({
        success: true,
        message: willComplete 
          ? "Autopool purchased successfully! Parent node completed." 
          : "Autopool purchased successfully",
        data: {
          autopoolId: newAutopoolEntry._id,
          position: position,
          parentUserId: availableNode.userId,
          level: newAutopoolEntry.level,
          walletUsed: walletType,
          parentCompleted: willComplete,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },

  // FIXED: Get user's autopool history
  async getAutopoolHistory(req, res) {
    try {
      const userId = req.user.userId; // This is "CGT8647"
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      // FIXED: Query by userId field, not _id
      const autopools = await Autopool.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Autopool.countDocuments({ userId });

      // Format the data to include position information
      const formattedAutopools = autopools.map(autopool => {
        let position = "root";
        if (autopool.level > 1) {
          position = autopool.leftNode && autopool.rightNode ? "filled" : "partial";
        }
        
        return {
          ...autopool.toObject(),
          position: position
        };
      });

      res.status(200).json({
        success: true,
        data: {
          autopools: formattedAutopools,
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
      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },

  // FIXED: Get autopool tree structure
  async getAutopoolTree(req, res) {
    try {
      const userId = req.user.userId;

      // FIXED: Query by userId field
      const userAutopool = await Autopool.findOne({ userId })
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
      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },

  // FIXED: Get autopool statistics
  async getAutopoolStats(req, res) {
    try {
      const userId = req.user.userId;

      const stats = await Autopool.aggregate([
        {
          $match: { userId }, // This should work fine as it's a string match
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
      res.status(500).json({
        success: false,
        message: error.message || "Something went wrong",
      });
    }
  },
};

module.exports = autopoolController;