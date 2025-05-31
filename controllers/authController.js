const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Profile = require("../models/profile");
const Wallet = require("../models/Wallet");
const { generateAndSaveOTP, verifyOTP } = require("../utils/otp");
const { encrypt, decrypt } = require("../utils/decrypt-Password");

//ROUTE: 1 Registering a user using: POST "/api/auth/register". It Doesn't require auth
exports.register = async (req, res) => {
  try {
    const { fullname, phone, email, password, referrer } = req.body;

    // Validate fields
    if (!fullname || !phone || !email || !password || !referrer) {
      return res
        .status(400)
        .json({ success: false, message: "All fields required" });
    }

   

    const existingUser = await User.findOne({ email }); // Check if email exists
    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "Email already exists" });
    }

    const referrerUser = await User.findOne({ userId: referrer }); // Verify referrer
    if (!referrerUser) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid referrer ID" });
    }

    const userId = `CGT${Math.floor(1000000 + Math.random() * 90000)}`; // Generate user ID

    const encryptedPassword = encrypt(password); // Encrypt password (instead of hashing)

    // Store user with encrypted password
    const user = await User.create({
      userId,
      fullname,
      email,
      phone,
      password: encryptedPassword,
      referrer,
      isVerified: true, // Set to true since we're skipping OTP
      status: "Active", // Set to active immediately
    });

    // Create profile
    await Profile.create({
      userId,
      fullname,
      phone,
      walletAddress: "",
      joinDate: new Date(),
    });

    // Create wallet with 0 balance
    await Wallet.create({
      userId,
      USDTBalance: 0,
    });

    // Return response (INSECURE - includes decrypted password)
    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        userId,
        email,
        fullname,
        phone,
        status: "Active",
        encryptedPassword,
        decryptedPassword: password,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

//ROUTE: 2 Verify OTP: POST "/api/auth/verify-otp". It Doesn't require auth
exports.verifyOtp = async (req, res) => {
  try {
    const { userId, otp } = req.body;

    // Validate input
    if (!userId || !otp) {
      return res.status(400).json({ message: "User ID and OTP are required" });
    }

    const user = await User.findOne({ userId });

    if (!user) return res.status(400).json({ message: "User not found" });

    // Pass user's MongoDB _id to verifyOTP, not the EUR00001 format userId
    const valid = await verifyOTP(user._id, otp);
    if (!valid) return res.status(400).json({ message: "Invalid OTP" });

    // Update verification status
    user.verified = true;
    user.status = "Active";
    await user.save();

    // Generate JWT token
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({
      message: "Registration successful",
      data: { authToken: token },
    });
  } catch (error) {
    console.error("OTP verification error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

//ROUTE: 3 Authenticate a user using: POST "/api/auth/login". It Doesn't require auth
exports.login = async (req, res) => {
  try {
    const { userId, password } = req.body;

    if (!userId || !password) {
      return res.status(400).json({ message: "User ID and password required" });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const decryptedPassword = decrypt(user.password);

    if (password !== decryptedPassword) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId, id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({
      message: "Login Successful",
      token: token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};


//ROUTE: 4 Logout a user: POST "/api/auth/logoutUser". It requires auth
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

//ROUTE: 5 Forgot Password: POST "/api/auth/forgot-password". It Doesn't require auth
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Validate input
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(400)
        .json({ message: "User with this email does not exist" });
    }

    // Use the existing OTP utility instead of creating a new one
    await generateAndSaveOTP(user._id.toString());

    res.status(200).json({
      success: true,
      message: "OTP sent to email",
    });
  } catch (error) {
    console.error("Error in forgotPasswordController:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

//ROUTE: 6 Reset Password: POST "/api/auth/reset-password". It Doesn't require auth
exports.resetPassword = async (req, res) => {
  try {
    const { userId, email, otp, newPassword } = req.body;

    // Validate inputs
    if (!userId || !email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
        missingFields: {
          userId: !userId,
          email: !email,
          otp: !otp,
          newPassword: !newPassword,
        },
      });
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Verify user ID matches
    if (user.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Verify OTP
    const isOTPValid = await verifyOTP(user._id.toString(), otp);
    if (!isOTPValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    // Encrypt new password (consistent with registration)
    const encryptedPassword = encrypt(newPassword);

    // Update user with encrypted password
    await User.findByIdAndUpdate(user._id, {
      password: encryptedPassword,
      $unset: {
        otp: 1,
        otpTimestamp: 1,
      },
    });

    res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

//ROUTE: 7 Get Decrypted Password: POST "/api/auth/get-decrypted-password". It Doesn't require auth
exports.getDecryptedPassword = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "User ID required" });
    }

    const user = await User.findOne({ userId });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Decrypt password
    const decryptedPassword = decrypt(user.password);

    res.status(200).json({
      success: true,
      message: "Password decrypted successfully",
      data: {
        userId,
        encryptedPassword: user.password,
        decryptedPassword,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
