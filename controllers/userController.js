const express = require("express");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Packages = require("../models/Packages");
const Transaction = require("../models/Transaction");
const Assets = require("../models/Assets");

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
    const { name, phone, email, walletAddress: newWalletAddress } = req.body;

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
    if (newWalletAddress !== undefined) updates.walletAddress = newWalletAddress;

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

    const walletAddressChanged = newWalletAddress !== undefined && newWalletAddress !== walletAddress;

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        userId: updatedUser.userId,
        name: updatedUser.name,
        email: updatedUser.email,
        phone: updatedUser.phone,
        walletAddress: updatedUser.walletAddress,
        parentId: updatedUser.parentId
      },
      requiresLogout: walletAddressChanged
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
      USDTBalance: wallet.USDTBalance,
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


exports.getRetopup = async (req, res) => {
  try {
    const walletAddress = req.user.walletAddress;
    console.log("Wallet Address:", walletAddress);
    
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

    // Get user's packages for total investment calculation
    const userPackages = await Packages.find({ userId: user.userId });
    const totalInvestment = userPackages.reduce(
      (sum, pkg) => sum + (pkg.packageAmount || 0),
      0
    );

    // Calculate total bonus earned
    const bonusInfo = await Transaction.aggregate([
      {
        $match: {
          userId: user.userId,
          transactionRemark: { $regex: /Bonus/i } // Case-insensitive bonus match
        }
      },
      {
        $group: {
          _id: null,
          totalBonusEarned: { $sum: "$creditedAmount" },
          count: { $sum: 1 }
        }
      }
    ]);

    const retopupData = {
      walletAddress: user.walletAddress,
      userId: user.userId,
      USDTBalance: wallet.USDTBalance,
      autopoolBalance: wallet.autopoolBalance,
      utilityBalance: wallet.utilityBalance,
      totalInvestment,
      totalBonusEarned: bonusInfo[0]?.totalBonusEarned || 0,
      createdAt: wallet.createdAt,
      lastUpdated: wallet.updatedAt,
    };

    return res.status(200).json({
      success: true,
      message: "Retopup data retrieved successfully",
      data: retopupData
    });

  } catch (error) {
    console.error("Error fetching retopup data:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get retopup data",
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

    // Get user's packages
    const userPackages = await Packages.find({ userId: user.userId });

    // Calculate total investment from user's packages
    const totalInvestment = userPackages.reduce(
      (sum, pkg) => sum + (pkg.packageAmount || 0),
      0
    );

    // Get referral counts
    const directTeam = await User.find({ parentId: user.userId });
    const totalDirectTeam = directTeam.length;
    
    // Count active direct referrals (users with at least one active package)
    const activeDirectTeam = await User.aggregate([
      { 
        $match: { 
          parentId: user.userId 
        } 
      },
      {
        $lookup: {
          from: "packages",
          localField: "userId",
          foreignField: "userId",
          as: "packages"
        }
      },
      {
        $match: {
          "packages.status": "Active" // Only count if package status is true (active)
        }
      },
      {
        $count: "activeCount"
      }
    ]);

    const totalActiveDirect = activeDirectTeam[0]?.activeCount || 0;

    // Calculate bonus information only
    const bonusInfo = await Transaction.aggregate([
      {
        $match: {
          userId: user.userId,
          transactionRemark: { $regex: /Bonus/i } // Case-insensitive bonus match
        }
      },
      {
        $group: {
          _id: null,
          totalBonusEarned: { $sum: "$creditedAmount" },
          count: { $sum: 1 }
        }
      }
    ]);

    // Get recent bonus transactions
    const recentBonuses = await Transaction.find({
      userId: user.userId,
      transactionRemark: { $regex: /bonus/i }
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('creditedAmount transactionRemark walletName createdAt status -_id');

    // Prepare response
    const dashboardData = {
      userInfo: {
        userId: user.userId,
        name: user.name
      },
      walletInfo: {
        USDTBalance: wallet.USDTBalance,
        autopoolBalance: wallet.autopoolBalance,
        utilityBalance: wallet.utilityBalance,
      },
      investmentInfo: {
        totalInvestment,
        activePackages: userPackages.filter(pkg => pkg.status).length,
        totalPackages: userPackages.length,
        packages: userPackages,
      },
      referralInfo: {
        totalDirectTeam,
        totalActiveDirect,
      },
      bonusInfo: {
        totalBonusEarned: bonusInfo[0]?.totalBonusEarned || 0
      },
      // allPackages: allPackages,
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

exports.getAsset = async (req, res) => {
  try {
    // Find the single assets document
    const asset = await Assets.findOne({}).lean();
    
    // If no document exists, return defaults
    if (!asset) {
      return res.status(200).json({
        success: true,
        asset: {
          liveRate: "",
          announcement: "",
          popUpImage: ""
        }
      });
    }

    // Prepare response with full image URL
    const response = {
      success: true,
      asset: {
        liveRate: asset.liveRate,
        announcement: asset.announcement || "",
        popUpImage: asset.popUpImage || ""
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error("Error in getAsset:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch asset data",
      error: error.message
    });
  }
};