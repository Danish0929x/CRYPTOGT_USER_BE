const express = require("express");
const User = require("../models/User");
const Profile = require("../models/profile");
const Wallet = require("../models/Wallet");

// ROUTE: 1 Get logged in user details: GET "/api/auth/getuser". It requires auth
exports.getUser = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Find by your custom userId field instead of _id
    const user = await User.findOne({ userId }).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User details fetched successfully",
      data: user,
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
// ROUTE: 2 Update profile: PUT "/api/user/update-profile". It may require auth
exports.updateProfile = async (req, res) => {
  const userId = req.user.userId;
  try {
    const { fullname, phone, withdrawalAddress } = req.body;

    // Validate userId matches authenticated user
    if (userId !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to update this profile",
      });
    }

    // Prepare User updates
    const userUpdates = {};
    if (fullname !== undefined) userUpdates.fullname = fullname;
    if (phone !== undefined) userUpdates.phone = phone;

    // Prepare Profile updates
    const profileUpdates = {};
    if (withdrawalAddress !== undefined) profileUpdates.withdrawAddress = withdrawalAddress;

    // If nothing to update
    if (Object.keys(userUpdates).length === 0 && Object.keys(profileUpdates).length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    // Parallel updates
    await Promise.all([
      User.findOneAndUpdate({ userId }, userUpdates, { new: true, runValidators: true }),
      Profile.findOneAndUpdate({ userId }, profileUpdates, { new: true, runValidators: true }),
    ]);

    // Fetch updated data
    const [updatedUser, updatedProfile] = await Promise.all([
      User.findOne({ userId }),
      Profile.findOne({ userId }),
    ]);

    if (!updatedUser || !updatedProfile) {
      return res.status(404).json({ success: false, message: "Profile not found after update" });
    }

    return res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      data: {
        userId: updatedUser.userId,
        email: updatedUser.email,
        fullname: updatedUser.fullname, // ➡️ Added fullname here
        withdrawAddress: updatedProfile.withdrawAddress || "",
        status: updatedUser.status,
        joinDate: updatedUser.createdAt
      }
    });

  } catch (error) {
    console.error("Update error:", error);
    return res.status(500).json({
      success: false,
      message: "Profile update failed",
    });
  }
};


// ROUTE 3: Get user profile - GET "/api/user/get-profile"
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Find user by custom userId (EUR12345)
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Find profile using the same custom userId
    const profile = await Profile.findOne({ userId });
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found for this user",
      });
    }

    // Combine relevant data
    const profileData = {
      userId: user.userId,
      fullname: user.fullname,  // Fetch fullname from User model instead of Profile
      email: user.email,
      phone: profile.phone,
      withdrawAddress: profile.withdrawAddress,
      status: user.status,
      isVerified: user.isVerified,
      joinDate: profile.createdAt,
    };

    res.status(200).json({
      success: true,
      message: "Profile retrieved successfully",
      data: profileData,
    });
  } catch (error) {
    console.error("Error fetching profile:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};


// ROUTE 4: Get user wallet - GET "/api/user/get-wallet"
exports.getWallet = async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // 1. Fetch the User document
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 2. Fetch the Wallet document
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    // 3. Build the payload
    const walletData = {
      userId:        wallet.userId,
      depositAddress: wallet.address,        // <— on-chain deposit address
      USDTBalance:    wallet.USDTBalance,
      depositBalance: wallet.depositBalance, // if you want to show this too
      fullname:       user.fullname,
      email:          user.email,
      status:         user.status,
      lastUpdated:    wallet.updatedAt,
      createdAt:      wallet.createdAt
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
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined
    });
  }
};


