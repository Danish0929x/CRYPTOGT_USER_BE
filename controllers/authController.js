const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const { hashPassword, comparePassword } = require("../utils/passwordUtils");
const { sendOTPEmail, sendTemporaryPasswordEmail } = require("../utils/emailService");
const { sendOTP, verifyOTP } = require("../utils/smsService");
const ResetOtp = require("../models/ResetOtp");

exports.register = async (req, res) => {
  try {
    const { name, phone, email, walletAddress, parentId, password } = req.body;

    const isEmailRegistration = !!password && !walletAddress;
    const isWalletRegistration = !!walletAddress && !password;

    if (!parentId) {
      return res.status(400).json({
        success: false,
        message: "Parent ID is required"
      });
    }

    const parentUser = await User.findOne({ userId: parentId.toUpperCase() });
    if (!parentUser) {
      return res.status(400).json({
        success: false,
        message: "Invalid parent ID"
      });
    }

    if (isWalletRegistration) {
      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          message: "Wallet address is required"
        });
      }

      const normalizedWalletAddress = walletAddress.toLowerCase();
      const existingUser = await User.findOne({ walletAddress: normalizedWalletAddress });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "Wallet address already registered"
        });
      }
    }

    if (isEmailRegistration) {
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email and password are required"
        });
      }

      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: "Email already registered"
        });
      }
    }

    let userId;
    let isUnique = false;
    while (!isUnique) {
      userId = `CGT${(Math.floor(Math.random() * 9999) + 1).toString().padStart(4, '0')}`;
      const existingUserId = await User.findOne({ userId });
      if (!existingUserId) {
        isUnique = true;
      }
    }

    let hashedPassword = null;
    let isEmailVerified = false;
    let normalizedWalletAddress = null;

    if (password) {
      hashedPassword = await hashPassword(password);
      isEmailVerified = true;
    }

    if (walletAddress) {
      normalizedWalletAddress = walletAddress.toLowerCase();
    } else {
      normalizedWalletAddress = `0x${userId}`;
    }

    const user = await User.create({
      walletAddress: normalizedWalletAddress,
      userId,
      name: name || null,
      email: email ? email.toLowerCase() : null,
      phone: phone || null,
      parentId: parentId.toUpperCase(),
      password: hashedPassword,
      isEmailVerified,
      verified: true,
      rewardStatus: "User",
      blockStatus: false
    });

    await Wallet.create({
      userId,
      USDTBalance: 0,
      autopoolBalance: 0,
      utilityBalance: 0
    });

    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        walletAddress: normalizedWalletAddress,
        userId,
        parentId: parentId.toUpperCase(),
        email: email ? email.toLowerCase() : null,
        phone,
        rewardStatus: "User",
        verified: true,
        hasPassword: !!password
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ROUTE: 2 Authenticate a user using: POST "/api/auth/login". It Doesn't require auth
exports.login = async (req, res) => {
  try {
    const { walletAddress } = req.body;

    // Validate required field
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: "Wallet address is required"
      });
    }

    // Normalize wallet address to lowercase for case-insensitive comparison
    const normalizedWalletAddress = walletAddress.toLowerCase();

    // Find user by wallet address
    const user = await User.findOne({ walletAddress: normalizedWalletAddress });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Wallet address not registered" 
      });
    }

    // Check if user is blocked
    if (user.blockStatus === true) {
      return res.status(403).json({
        success: false,
        message: "Account is blocked"
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.userId,
        walletAddress: normalizedWalletAddress,
        id: user._id
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // Return success response with token
    res.status(200).json({
      success: true,
      message: "Login Successful",
      token: token
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ 
      success: false,
      message: "Server Error", 
      error: err.message 
    });
  }
};

exports.logoutUser = async (req, res) => {
  try {
    res.clearCookie("token", {
      expires: new Date(Date.now()),
    });

    res.status(200).json({
      success: true,
      message: "Logged Out",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Error during logout",
    });
  }
};

exports.emailPasswordLogin = async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({
        success: false,
        message: "User ID and password are required"
      });
    }

    const user = await User.findOne({ userId: userId.toUpperCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User ID not found"
      });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: "Please set a password first"
      });
    }

    if (user.blockStatus === true) {
      return res.status(403).json({
        success: false,
        message: "Account is blocked"
      });
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid password"
      });
    }

    const token = jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        walletAddress: user.walletAddress,
        id: user._id
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      success: true,
      message: "Login Successful",
      token: token
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

exports.setPassword = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email and new password are required"
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Email not found"
      });
    }

    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    user.isEmailVerified = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password set successfully"
    });
  } catch (err) {
    console.error("Set password error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { email, oldPassword, newPassword } = req.body;

    if (!email || !oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, old password, and new password are required"
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Email not found"
      });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        message: "No password set for this account"
      });
    }

    const isOldPasswordValid = await comparePassword(oldPassword, user.password);
    if (!isOldPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Old password is incorrect"
      });
    }

    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully"
    });
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

exports.verifyResetEmail = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    const user = await User.findOne({ userId: userId.toUpperCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User ID not found"
      });
    }

    res.status(200).json({
      success: true,
      message: "User ID verified"
    });
  } catch (err) {
    console.error("Verify user ID error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { userId, newPassword } = req.body;

    if (!userId || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "User ID and new password are required"
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters"
      });
    }

    const user = await User.findOne({ userId: userId.toUpperCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User ID not found"
      });
    }

    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    user.isEmailVerified = true;
    user.resetOTP = null;
    user.resetOTPExpiresAt = null;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successfully"
    });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

exports.sendResetOTP = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    const user = await User.findOne({ userId: userId.toUpperCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User ID not found"
      });
    }

    if (!user.phone) {
      return res.status(400).json({
        success: false,
        message: "No registered phone number found for this user"
      });
    }

    // Prevent spam: 60 second cooldown between OTP requests
    const recentOtp = await ResetOtp.findOne({
      userId: user.userId,
      purpose: "resetPassword",
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
    });

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        message: "OTP already sent. Please wait 60 seconds before requesting again."
      });
    }

    // Send OTP via 2Factor.in (AUTOGEN — 2Factor generates the code)
    const phone = user.phone.startsWith("91") ? user.phone : `91${user.phone}`;
    let sessionId;
    try {
      sessionId = await sendOTP(phone);
    } catch (smsError) {
      console.error("Reset OTP sending failed:", smsError);
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP. Please try again later."
      });
    }

    // Store the session ID (remove any previous ones for this user)
    await ResetOtp.deleteMany({ userId: user.userId, purpose: "resetPassword" });
    await ResetOtp.create({
      userId: user.userId,
      sessionId,
      purpose: "resetPassword",
    });

    const digits = String(user.phone).replace(/\D/g, "");
    const phoneHint = digits.length >= 4
      ? `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`
      : "registered phone";

    res.status(200).json({
      success: true,
      message: "OTP sent to your registered phone number",
      phoneHint
    });
  } catch (err) {
    console.error("Send OTP error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};

exports.verifyResetOTP = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
      return res.status(400).json({
        success: false,
        message: "User ID and OTP are required"
      });
    }

    const user = await User.findOne({ userId: userId.toUpperCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User ID not found"
      });
    }

    // Look up the 2Factor session for this user
    const resetOtp = await ResetOtp.findOne({
      userId: user.userId,
      purpose: "resetPassword",
    }).sort({ createdAt: -1 });

    if (!resetOtp) {
      return res.status(400).json({
        success: false,
        message: "OTP not found or expired. Please request a new one."
      });
    }

    // Verify the code with 2Factor.in
    let isValid;
    try {
      isValid = await verifyOTP(resetOtp.sessionId, otp);
    } catch (verifyError) {
      console.error("Reset OTP verification failed:", verifyError);
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP"
      });
    }

    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    // Mark verified and clean up the session
    resetOtp.verified = true;
    await resetOtp.save();

    res.status(200).json({
      success: true,
      message: "OTP verified successfully"
    });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message
    });
  }
};