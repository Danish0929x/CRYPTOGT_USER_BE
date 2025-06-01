const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

//ROUTE: 1 Registering a user using: POST "/api/auth/register". It Doesn't require auth
exports.register = async (req, res) => {
  try {
    const { name, phone, email, wallet_address,  } = req.body;

    // Validate required fields
    if (!wallet_address ) {
      return res.status(400).json({ 
        success: false, 
        message: "Wallet address and referral ID are required" 
      });
    }

    // Check if wallet address already exists
    const existingUser = await User.findOne({ wallet_address });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: "Wallet address already registered" 
      });
    }

    // Verify referrer exists (if needed)
    // const referrerUser = await User.findOne({ userId: referral_id });
    // if (!referrerUser) {
    //   return res.status(400).json({ 
    //     success: false, 
    //     message: "Invalid referral ID" 
    //   });
    // }

    // Generate user ID
    const userId = `CGT${Math.floor(1000000 + Math.random() * 90000)}`;

    // Create user
    const user = await User.create({
      wallet_address,
      userId,
      name,
      email,
      phone,
      // referral_id,
      verified: true,
      status: "Active"
    });


    // Create wallet (if still needed)
    await Wallet.create({
      userId,
      CGTBalance: 0,
    });

    // Return response
    res.status(201).json({
      success: true,
      message: "Registration successful",
      data: {
        wallet_address,
        userId,
        // referral_id,
        name,
        email,
        phone,
        status: "Active"
      }
    });
  } catch (err) {
    res.status(500).json({ 
      success: false, 
      error: err.message 
    });
  }
};


//ROUTE: 2 Authenticate a user using: POST "/api/auth/login". It Doesn't require auth
exports.login = async (req, res) => {
  try {
    const { wallet_address } = req.body;

    // Validate required field
    if (!wallet_address) {
      return res.status(400).json({ 
        success: false,
        message: "Wallet address is required" 
      });
    }

    // Find user by wallet address
    const user = await User.findOne({ wallet_address });
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Wallet address not registered" 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.userId, 
        wallet_address: user.wallet_address,
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
}
