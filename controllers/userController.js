const express = require("express");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

// ROUTE: 1 Get logged in user details using wallet address
exports.getUser = async (req, res) => {
  try {
    const wallet_address = req.user.wallet_address;

    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        message: "Wallet address is required",
      });
    }

    const user = await User.findOne({ wallet_address });

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
        wallet_address: user.wallet_address,
        userId: user.userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        referral_id: user.referral_id,
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
  const wallet_address = req.user.wallet_address;
  try {
    const { name, phone, email } = req.body;

    // Validate wallet_address matches authenticated user
    if (!wallet_address) {
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
      { wallet_address },
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
        wallet_address: updatedUser.wallet_address
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
    const wallet_address = req.user.wallet_address;
    
    if (!wallet_address) {
      return res.status(400).json({
        success: false,
        message: "Wallet address is required",
      });
    }

    const user = await User.findOne({ wallet_address });
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
      wallet_address: user.wallet_address,
      userId: user.userId,
      CGTBalance: wallet.CGTBalance,
      depositBalance: wallet.depositBalance || 0,
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