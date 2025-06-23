const express = require("express");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Packages = require("../models/Packages");
const Transaction = require("../models/Transaction");

// ROUTE: 1 Get logged in user details using wallet address
exports.getUser = async (req, res) => {
  try {
    const walletAddress = req.user.walletAddress;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: "Wallet address is required",
      });
    }

    const user = await User.findOne({ walletAddress });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User details fetched successfully",
      data: {
        walletAddress: user.walletAddress,
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        parentId: user.parentId,
        status: user.status
      },
    });
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ROUTE: 2 Update profile using wallet address
exports.updateUser = async (req, res) => {
  const walletAddress = req.user.walletAddress;
  try {
    const { name, phone, email } = req.body;

    // Validate walletAddress matches authenticated user
    if (!walletAddress) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to update this profile",
      });
    }

    // Prepare updates
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;

    // If nothing to update
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: "No fields to update" 
      });
    }

    const updatedUser = await User.findOneAndUpdate(
      { walletAddress },
      updates,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found after update" 
      });
    }

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        userId: updatedUser.userId,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        walletAddress: updatedUser.walletAddress
      }
    });

  } catch (error) {
    console.error("Update error:", error);
    return res.status(500).json({
      success: false,
      message: "Profile update failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// ROUTE 4: Get user wallet using wallet address
exports.getWallet = async (req, res) => {
  try {
    const walletAddress = req.user.walletAddress;
    
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: "Wallet address is required",
      });
    }

    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const wallet = await Wallet.findOne({ userId: user.userId });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    const walletData = {
      walletAddress: user.walletAddress,
      userId: user.userId,
      CGTBalance: wallet.CGTBalance,
      autopoolBalance: wallet.autopoolBalance,
      utilityBalance: wallet.utilityBalance,
      createdAt:      wallet.createdAt,
      lastUpdated: wallet.updatedAt,
    };

    return res.status(200).json({
      success: true,
      message: "Wallet retrieved successfully",
      data: walletData
    });

  } catch (error) {
    console.error("Error fetching wallet:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get wallet",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
};


// ROUTE: Get Dashboard Data including all packages
exports.getDashboard = async (req, res) => {
  try {
    const walletAddress = req.user.walletAddress;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: "Wallet address is required",
      });
    }

    // Get user details
    const user = await User.findOne({ walletAddress });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get wallet details
    const wallet = await Wallet.findOne({ userId: user.userId });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    // Get all packages (both active and inactive)
    const allPackages = await Packages.find({});

    // Get user's active packages
    const userPackages = await Packages.find({ userId: user.userId });

    // Calculate total investment from user's packages
    const totalInvestment = userPackages.reduce(
      (sum, pkg) => sum + (pkg.investedAmount || 0),
      0
    );

    // Get transaction summary
    const txAggregate = await Transaction.aggregate([
      { $match: { userId: user.userId } },
      {
        $group: {
          _id: null,
          totalDeposits: {
            $sum: {
              $cond: [
                { $eq: ["$transactionType", "deposit"] },
                "$creditedAmount",
                0,
              ],
            },
          },
          totalWithdrawals: {
            $sum: {
              $cond: [
                { $eq: ["$transactionType", "withdrawal"] },
                "$debitedAmount",
                0,
              ],
            },
          },
          totalEarnings: {
            $sum: {
              $cond: [
                { $eq: ["$transactionType", "earning"] },
                "$creditedAmount",
                0,
              ],
            },
          },
        },
      },
    ]);

    const transactionSummary = txAggregate[0] || {
      totalDeposits: 0,
      totalWithdrawals: 0,
      totalEarnings: 0,
    };

    // Get referral count
    const referralCount = await User.countDocuments({
      referrer: user.userId,
    });

    // Prepare response
    const dashboardData = {
      userInfo: {
        userId: user.userId,
        name: user.name,
        email: user.email,
        walletAddress: user.walletAddress,
        parentId: user.parentId,
        status: user.status,
        joinDate: user.createdAt,
      },
      walletInfo: {
        CGTBalance: wallet.CGTBalance
      },
      investmentInfo: {
        totalInvestment,
        activePackages: userPackages.length,
        packages: userPackages,
      },
      transactionSummary,
      referralInfo: {
        referralCount,
      },
      allPackages: allPackages, // All available packages in the system
    };

    res.status(200).json({
      success: true,
      message: "Dashboard data retrieved successfully",
      data: dashboardData,
    });

  } catch (error) {
    console.error("Error fetching dashboard data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get dashboard data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};