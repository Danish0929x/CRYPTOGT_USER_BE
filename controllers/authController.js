const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

// ROUTE: 1 Registering a user using: POST "/api/auth/register". It Doesn't require auth
exports.register = async (req, res) => {
  try {
    const { name, phone, email, walletAddress, parentId } = req.body;

    // Validate required fields
    if (!walletAddress) {
      return res.status(400).json({ 
        success: false, 
        message: "Wallet address is required" 
      });
    }

    // Check if wallet address already exists
    const existingUser = await User.findOne({ walletAddress });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: "Wallet address already registered" 
      });
    }

    // Verify parent user exists (parentId is required in model)
    if (!parentId) {
      return res.status(400).json({ 
        success: false, 
        message: "Parent ID is required" 
      });
    }

    const parentUser = await User.findOne({ userId: parentId });
    if (!parentUser) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid parent ID" 
      });
    }

     // Generate unique user ID (check exists before use)
    let userId;
    let isUnique = false;
    while (!isUnique) {
      userId = `CGT${(Math.floor(Math.random() * 9999) + 1).toString().padStart(4, '0')}`;
      const existingUserId = await User.findOne({ userId });
      if (!existingUserId) {
        isUnique = true;
      }
    }
    // Create user with required fields from model
    const user = await User.create({
      walletAddress,
      userId,
      name: name || null,
      email: email || null,
      phone: phone || null,
      parentId,
      verified: true,
      rewardStatus: "User", // Default status
      blockStatus: false // Default from model
    });

    // Create wallet with all required fields
    await Wallet.create({
      userId,
      CGTBalance: 0,
      autopoolBalance: 0,
      utilityBalance: 0
    });

    // Return response
    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        walletAddress,
        userId,
        parentId,
        name,
        email,
        phone,
        rewardStatus: "User",
        verified: true
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

    // Find user by wallet address
    const user = await User.findOne({ walletAddress });
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
        walletAddress: user.walletAddress,
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

// ROUTE: 3 Logout a user: POST "/api/auth/logoutUser". It requires auth
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