// Function to withdraw USDT to CGT Homes
const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { performWalletTransaction } = require("../utils/performWalletTransaction");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();
const CGT_HOMES_API_URL = process.env.CGT_HOMES_API_URL || "https://cgt-homes-be.onrender.com/api";

const withdrawUSDTToCGTHomes = async (req, res) => {
  const { amount } = req.body;
  const userId = req.user.userId;

  try {
    // Validate amount
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount provided"
      });
    }

    const amountToWithdraw = parseFloat(amount);

    // Find user and check if connected to CGTHomes
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Check if user has connected their CGTHomes account
    if (!user.connectedCGTHomesEmail) {
      return res.status(400).json({
        success: false,
        message: "CGT Homes account not connected. Please connect your account first."
      });
    }

    // Find user's wallet
    const userWallet = await Wallet.findOne({ userId });
    if (!userWallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found"
      });
    }

    // Check if user has sufficient balance
    if (userWallet.USDTBalance < amountToWithdraw) {
      return res.status(400).json({
        success: false,
        message: "Insufficient USDT balance",
        requiredAmount: amountToWithdraw,
        availableBalance: userWallet.USDTBalance
      });
    }


    // Calculate amounts based on rates
    const ADJUSTMENT_RATE = 0.85;
    const UTILITY_RATE = 0.05;
    const AUTOPOOL_RATE = 0.05;
    
    const transferAmount = amountToWithdraw * ADJUSTMENT_RATE;
    const utilityAmount = amountToWithdraw * UTILITY_RATE;
    const autopoolAmount = amountToWithdraw * AUTOPOOL_RATE;

    // Perform wallet transaction (deduct from USDT balance)
    const transaction = await performWalletTransaction(
      userId,
      -amountToWithdraw, // Negative amount for withdrawal (full amount)
      "USDTBalance",
      `Withdrawal USDT - USDT Transfer to CGT Homes`,
      "Completed", // Mark as completed immediately
      {
        metadata: {
          transferType: "CGTHomes",
          destinationEmail: user.connectedCGTHomesEmail,
        }
      }
    );

    // Add 5% to utility balance
    await performWalletTransaction(
      userId,
      utilityAmount,
      "utilityBalance",
      `Utility allocation from CGT Homes transfer`,
      "Completed",
      {
        metadata: {
          sourceTransaction: transaction._id,
          transferType: "CGTHomesUtility"
        }
      }
    );

    // Add 5% to autopool balance
    await performWalletTransaction(
      userId,
      autopoolAmount,
      "autopoolBalance",
      `Autopool allocation from CGT Homes transfer`,
      "Completed",
      {
        metadata: {
          sourceTransaction: transaction._id,
          transferType: "CGTHomesAutopool"
        }
      }
    );

    // Integration with CGT Homes API to credit the amount to the user's CGT Homes account
    try {
      // Call the CGT Homes API to add balance to the user's account (85% of original amount)
      const cgtHomesResponse = await axios.post(`${CGT_HOMES_API_URL}/wallet/add-balance`, {
        email: user.connectedCGTHomesEmail,
        amount: transferAmount * 90,
        transactionRemark: `Transfer from CryptoGT - User: ${userId}`,
        liveToken: transferAmount,
        status: "Success"
      });

      if (!cgtHomesResponse.data.success) {
        console.error("CGT Homes API responded with an error:", cgtHomesResponse.data);
        // Although we continue with the response, we should log this for reconciliation
      } else {
        // console.log("Successfully added balance to CGT Homes account:", user.connectedCGTHomesEmail);
      }
    } catch (apiError) {
      console.error("Error calling CGT Homes API:", apiError.message);
    }

    return res.status(200).json({
      success: true,
      message: "USDT successfully transferred to CGT Homes",
      data: {
        transactionId: transaction._id,
        totalAmount: amountToWithdraw,
        transferredToCGTHomes: transferAmount,
        utilityAllocation: utilityAmount,
        autopoolAllocation: autopoolAmount,
        destinationEmail: user.connectedCGTHomesEmail,
        timestamp: transaction.createdAt
      }
    });
  } catch (error) {
    console.error("Error in CGT Homes USDT transfer:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};

module.exports = {
  withdrawUSDTToCGTHomes
};