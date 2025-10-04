// controllers/accountConnectionController.js
const axios = require('axios');

// Import Cryptography User model (adjust path to your existing User model)
const CryptoUser = require('../models/User');

// CGTHomes API endpoint
const CGTHOMES_API_URL = 'https://cgt-homes-be.onrender.com/api/auth/login';

// Connect CGTHomes account
const connectCGTHomesAccount = async (req, res) => {
  const { email, password } = req.body;
  const cryptoUserId = req.user.userId;

  try {
    if (!email || !password) {
      return res.status(400).json({ 
        error: "Email and password are required" 
      });
    }

    // Find Cryptography user
    const cryptoUser = await CryptoUser.findOne({userId: cryptoUserId});
    
    if (!cryptoUser) {
      return res.status(404).json({ 
        error: "Cryptography user not found" 
      });
    }

    // Check if already connected
    if (cryptoUser.connectedCGTHomesEmail) {
      return res.status(400).json({ 
        error: "Account already connected to CGTHomes",
        connectedEmail: cryptoUser.connectedCGTHomesEmail
      });
    }

    // Verify credentials via CGTHomes API
    let cgtHomesResponse;
    try {
      cgtHomesResponse = await axios.post(CGTHOMES_API_URL, {
        email,
        password
      });
      
    } catch (apiError) {
      if (apiError.response) {
        const errorMessage = apiError.response.data.error || 'Invalid CGTHomes credentials';
        return res.status(apiError.response.status).json({ 
          error: errorMessage 
        });
      }
      
      return res.status(500).json({ 
        error: "Failed to connect to CGTHomes service" 
      });
    }

    // Check if login was successful
    if (!cgtHomesResponse.data || !cgtHomesResponse.data.user) {
      return res.status(400).json({ 
        error: "Invalid response from CGTHomes service" 
      });
    }

    const cgtHomesUser = cgtHomesResponse.data.user;

    // Check if this email is already connected to another crypto account
    const existingConnection = await CryptoUser.findOne({ 
      connectedCGTHomesEmail: email 
    });
    
    if (existingConnection && existingConnection.userId !== cryptoUserId) {
      return res.status(400).json({ 
        error: "This CGTHomes account is already connected to another Cryptography account" 
      });
    }

    // Connect the accounts
    cryptoUser.connectedCGTHomesEmail = email;
    cryptoUser.cgtHomesConnectedAt = new Date();
    
    // Optionally sync data from CGTHomes response
    if (!cryptoUser.name && cgtHomesUser.name) {
      cryptoUser.name = cgtHomesUser.name;
    }
    if (!cryptoUser.phone && cgtHomesUser.phone) {
      cryptoUser.phone = cgtHomesUser.phone;
    }

    await cryptoUser.save();

    res.json({
      success: true,
      message: "CGTHomes account connected successfully",
      connectedEmail: email,
      connectedAt: cryptoUser.cgtHomesConnectedAt,
      cryptoUser: {
        userId: cryptoUser.userId,
        walletAddress: cryptoUser.walletAddress,
        name: cryptoUser.name,
        email: cryptoUser.email,
      },
      cgtHomesUser: {
        name: cgtHomesUser.name,
        email: cgtHomesUser.email,
        phone: cgtHomesUser.phone,
        profileImage: cgtHomesUser.profileImage,
      }
    });

  } catch (error) {
    console.error("Error connecting accounts:", error);
    res.status(500).json({ 
      error: "Internal server error while connecting accounts" 
    });
  }
};

// Disconnect CGTHomes account
const disconnectCGTHomesAccount = async (req, res) => {
  const cryptoUserId = req.user.userId;

  try {
    const cryptoUser = await CryptoUser.findOne({userId: cryptoUserId});
    if (!cryptoUser) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!cryptoUser.connectedCGTHomesEmail) {
      return res.status(400).json({ error: "No CGTHomes account connected" });
    }

    const previousEmail = cryptoUser.connectedCGTHomesEmail;
    cryptoUser.connectedCGTHomesEmail = null;
    cryptoUser.cgtHomesConnectedAt = null;
    await cryptoUser.save();

    res.json({
      success: true,
      message: "CGTHomes account disconnected successfully",
      previousEmail
    });

  } catch (error) {
    console.error("Error disconnecting account:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Get connection status
const getConnectionStatus = async (req, res) => {
  const cryptoUserId = req.user.userId;

  try {
    const cryptoUser = await CryptoUser.findOne({userId: cryptoUserId})
      .select('connectedCGTHomesEmail cgtHomesConnectedAt userId walletAddress name email');

    if (!cryptoUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const isConnected = !!cryptoUser.connectedCGTHomesEmail;

    res.json({
      isConnected,
      connectedEmail: cryptoUser.connectedCGTHomesEmail,
      connectedAt: cryptoUser.cgtHomesConnectedAt,
      cryptoUser: {
        userId: cryptoUser.userId,
        walletAddress: cryptoUser.walletAddress,
        name: cryptoUser.name,
        email: cryptoUser.email,
      }
    });

  } catch (error) {
    console.error("Error getting connection status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  connectCGTHomesAccount,
  disconnectCGTHomesAccount,
  getConnectionStatus,
};