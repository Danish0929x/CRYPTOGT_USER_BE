const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const {
  performWalletTransaction,
} = require("../utils/performWalletTransaction");
const User = require("../models/User");
const Assets = require("../models/Assets");
const { makeCryptoTransaction } = require("../utils/makeCryptoTransaction");
const { makeCryptoTransaction: makeUSDTCryptoTransaction } = require("../utils/makeUSDTCryptoTransaction");
const Package = require("../models/Packages");
const WithdrawOtp = require("../models/WithdrawOtp");
const { sendOTP, verifyOTP } = require("../utils/smsService");
const axios = require("axios");
require("dotenv").config();

const CGT_HOMES_API_URL = process.env.CGT_HOMES_API_URL || "https://cgt-homes-be.onrender.com/api";

/**
 * Withdraw USDT equivalent of given USD amount
 */
const withdrawUSDT = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount } = req.body; // amount in USD

    // 1. Validate amount (minimum 10 USDT)
    if (!amount || isNaN(amount) || Number(amount) < 10) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal amount is $10",
      });
    }

    const usdAmount = Number(amount);

    // 2. Check for existing pending withdrawal (transaction remark starts with "Withdraw USDT")
    const pendingWithdrawal = await Transaction.findOne({
      userId,
      status: "Pending",
      transactionRemark: { $regex: "^Withdraw USDT" },
    });

    if (pendingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: "You already have a pending withdrawal request",
      });
    }

    // 3. Find wallet and check balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    if (wallet.USDTBalance < usdAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient USDT balance",
      });
    }

    // 4. Check if user already withdrew today (completed withdrawals with transaction remark starting with "Withdraw USDT")
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const withdrawnToday = await Transaction.findOne({
      userId,
      debitedAmount: { $gt: 0 },
      transactionRemark: { $regex: "^Withdraw USDT" },
      walletName: "USDTBalance",
      status: "Completed",
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    });

    if (withdrawnToday) {
      return res.status(400).json({
        success: false,
        message: "You can only withdraw once per day",
      });
    }

    // 5. Perform transaction
    const transaction = await performWalletTransaction(
      userId,
      -usdAmount,
      "USDTBalance",
      "Withdraw USDT - Withdraw USDT",
      "Pending"
    );

    if (!transaction.debitedAmount < 500) {
      payout(transaction);
    }

    res.status(200).json({
      success: true,
      message: "Withdrawal request submitted successfully",
      data: {
        USDRequested: usdAmount,
        status: "Pending",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

const payout = async (transaction) => {
  try {
    // 1. Get user wallet to fetch the wallet address
    const user = await User.findOne({ userId: transaction.userId });
    if (!user || !user.walletAddress) {
      return;
    }

    // 2. Validate wallet address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress)) {
      return;
    }

    // 3. Get live rate from Assets
    const assetsData = await Assets.findOne({});
    if (!assetsData || !assetsData.liveRate || assetsData.liveRate <= 0) {
      return;
    }

    const liveRate = assetsData.liveRate;
    const fromWalletAddress = "0x5C28b3979609eF43A2C4B73257d540cd29d9C1F0";

    // 4. Calculate amounts
    const requestedAmount = Math.abs(transaction.debitedAmount); // Get positive amount
    const ADJUSTMENT_RATE = 0.85;
    const UTILITY_RATE = 0.05;
    const AUTOPOOL_RATE = 0.05;

    const adjustedUSDTAmount = requestedAmount * ADJUSTMENT_RATE;
    const tokenAmountToSend = adjustedUSDTAmount / liveRate;
    const utilityAmount = requestedAmount * UTILITY_RATE;
    const autopoolAmount = requestedAmount * AUTOPOOL_RATE;

    // 5. Validate calculated amounts
    if (tokenAmountToSend <= 0) {
      return;
    }

    // 6. Make crypto transaction
    const txnHash = await makeCryptoTransaction(
      tokenAmountToSend,
      user.walletAddress
    );

    if (!txnHash) {
      return;
    }

    // 7. Update transaction status
    const updatedTransaction = await Transaction.findByIdAndUpdate(
      transaction._id,
      {
        status: "Completed",
        txHash: txnHash,
        fromAddress: fromWalletAddress,
        toAddress: user.walletAddress,
        tokenRate: liveRate,
        metadata: {
          processedAt: new Date(),
          tokensSent: tokenAmountToSend,
          adjustedAmount: adjustedUSDTAmount,
          utilityBonus: utilityAmount,
          autopoolBonus: autopoolAmount,
        },
      },
      { new: true }
    );

    if (!updatedTransaction) {
      return;
    }

    // 8. Add utility and autopool bonuses
    await performWalletTransaction(
      transaction.userId,
      utilityAmount,
      "utilityBalance",
      "Utility Bonus From withdraw",
      "Completed"
    );

    await performWalletTransaction(
      transaction.userId,
      autopoolAmount,
      "autopoolBalance",
      "Autopool Bonus From withdraw",
      "Completed"
    );
  } catch (error) {
    // Optional: Update transaction status to failed
    try {
      await Transaction.findByIdAndUpdate(transaction._id, {
        status: "Failed",
        metadata: {
          ...transaction.metadata,
          failedAt: new Date(),
          errorMessage: error.message,
        },
      });
    } catch (updateError) {
      // Silent fail
    }
  }
};

/**
 * Send OTP for Hybrid Package Withdrawal
 * Sends OTP to user's registered phone number via 2Factor.in
 */
const sendWithdrawOTP = async (req, res) => {
  try {
    const userId = req.user.userId;

    // 1. Find user and validate phone number
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number not registered. Please update your profile first.",
      });
    }

    // 2. Check for existing recent OTP (prevent spam, 60 second cooldown)
    const recentOtp = await WithdrawOtp.findOne({
      userId,
      purpose: "withdrawHybrid",
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) },
    });

    if (recentOtp) {
      return res.status(429).json({
        success: false,
        message: "OTP already sent. Please wait 60 seconds before requesting again.",
      });
    }

    // 3. Send OTP via 2Factor.in
    const phone = user.phone.startsWith("91") ? user.phone : `91${user.phone}`;
    const sessionId = await sendOTP(phone);

    // 4. Store session ID in DB (remove old ones for this user)
    await WithdrawOtp.deleteMany({ userId, purpose: "withdrawHybrid" });
    await WithdrawOtp.create({
      userId,
      sessionId,
      purpose: "withdrawHybrid",
    });

    res.status(200).json({
      success: true,
      message: "OTP sent successfully to your registered phone number",
      data: {
        phone: user.phone.slice(-4).padStart(user.phone.length, "*"),
      },
    });
  } catch (error) {
    console.error("Send Withdraw OTP error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send OTP. Please try again.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Withdraw Hybrid Package — manual admin approval flow.
 * User-side: atomically lock package (Matured → PendingWithdraw) →
 * create Pending Transaction. No crypto, no credits, no CGT Homes call yet.
 * Admin Accept performs the actual distribution; Admin Reject restores the package.
 */
const withdrawHybrid = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageId } = req.body;

    // 1. Validate packageId
    if (!packageId) {
      return res.status(400).json({
        success: false,
        message: "Package ID is required",
      });
    }

    // 2. Find user and check CGT Homes connection
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.connectedCGTHomesEmail) {
      return res.status(400).json({
        success: false,
        message: "CGT Homes account not connected. Please connect your account first.",
      });
    }

    // 3. Validate wallet address (re-validated at admin accept time)
    if (!user.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress)) {
      return res.status(400).json({
        success: false,
        message: "Valid wallet address required for direct USDT withdrawal",
      });
    }

    // 4. ATOMIC LOCK: transition the package Matured → PendingWithdraw only if it
    //    belongs to this user, is Hybrid, and is currently Matured. Single op,
    //    no race, no double-request.
    const lockedPackage = await Package.findOneAndUpdate(
      {
        _id: packageId,
        userId,
        packageType: "Hybrid",
        status: "Matured",
      },
      { $set: { status: "PendingWithdraw" } },
      { new: true }
    );

    if (!lockedPackage) {
      const existing = await Package.findById(packageId);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Package not found" });
      }
      if (existing.userId !== userId) {
        return res.status(403).json({
          success: false,
          message: "Unauthorized: This package does not belong to you",
        });
      }
      if (existing.packageType !== "Hybrid") {
        return res.status(400).json({ success: false, message: "Package type must be Hybrid" });
      }
      if (existing.status === "PendingWithdraw") {
        return res.status(400).json({
          success: false,
          message: "Withdrawal already requested. Awaiting admin approval.",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Package must be matured before withdrawal",
        currentStatus: existing.status,
      });
    }

    // 5. Create Pending transaction. Admin accept will use this row + metadata to
    //    drive the actual distribution.
    const pendingTx = new Transaction({
      userId,
      walletName: "USDTBalance",
      creditedAmount: 0,
      debitedAmount: 0,
      transactionRemark: `Hybrid Package Withdrawal - $10 (Awaiting admin approval, Package: ${packageId})`,
      status: "Pending",
      toAddress: user.walletAddress,
      metadata: {
        withdrawalType: "HybridPackage",
        packageId: String(packageId),
        realWalletAmount: 10,
        retopupWalletAmount: 10,
        cgtHomesUsdtAmount: 10,
        cgtHomesCoinAmount: 900,
        destinationEmail: user.connectedCGTHomesEmail,
      },
    });
    await pendingTx.save();

    return res.status(200).json({
      success: true,
      message: "Withdraw request submitted. Awaiting admin approval.",
      data: {
        transactionId: pendingTx._id,
        packageId: lockedPackage._id,
        packageStatus: lockedPackage.status,
        status: "Pending",
      },
    });
  } catch (error) {
    console.error("Withdraw Hybrid error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get all Hybrid withdrawal history
 */
const getHybridWithdrawalHistory = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Fetch all transactions where transactionRemark is "Hybrid Package Withdrawal"
    const withdrawalHistory = await Transaction.find({
      userId,
      transactionRemark: "Hybrid Package Withdrawal",
    })
      .sort({ createdAt: -1 }) // Sort by newest first
      .lean();

    // Return the withdrawal history
    res.status(200).json({
      success: true,
      message: "Hybrid withdrawal history fetched successfully",
      count: withdrawalHistory.length,
      data: withdrawalHistory,
    });
  } catch (error) {
    console.error("Get Hybrid Withdrawal History error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Manual-approval flow: user request only LOCKS the balance and creates a Pending
// transaction. Crypto send + main-balance credit are performed later by admin via
// /admin/accept-hybrid-balance-withdrawal. Rejection refunds the locked balance.
const withdrawHybridBalance = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount } = req.body;

    // 1. Validate amount
    if (!amount || isNaN(amount) || Number(amount) < 5) {
      return res.status(400).json({
        success: false,
        message: "Minimum withdrawal amount is $5",
      });
    }

    if (Number(amount) > 100) {
      return res.status(400).json({
        success: false,
        message: "Maximum withdrawal amount is $100",
      });
    }

    const withdrawAmount = Number(amount);

    // 2. Find user
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // 3. Validate wallet address (re-validated at admin accept time)
    if (!user.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress)) {
      return res.status(400).json({
        success: false,
        message: "Valid wallet address required for hybrid withdrawal",
      });
    }

    // 4. Block if user already has an unresolved hybrid-balance request
    const pendingWithdrawal = await Transaction.findOne({
      userId,
      walletName: "hybridBalance",
      status: { $in: ["Pending", "Processing"] },
      transactionRemark: { $regex: "^Withdraw Hybrid Balance" },
    });

    if (pendingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: "You already have a pending hybrid balance withdrawal request",
      });
    }

    // 5. ATOMIC: lock balance only if sufficient (prevents double-spend race)
    const wallet = await Wallet.findOneAndUpdate(
      { userId, hybridBalance: { $gte: withdrawAmount } },
      { $inc: { hybridBalance: -withdrawAmount } },
      { new: true }
    );

    if (!wallet) {
      const existingWallet = await Wallet.findOne({ userId });
      if (!existingWallet) {
        return res.status(404).json({
          success: false,
          message: "Wallet not found",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Insufficient hybrid balance",
        availableBalance: existingWallet.hybridBalance,
      });
    }

    // 6. Create Pending transaction. Admin accept will mutate this row.
    const usdtPortion = Number((withdrawAmount * 0.50).toFixed(5));
    const mainBalancePortion = Number((withdrawAmount * 0.30).toFixed(5));

    const pendingTx = new Transaction({
      userId,
      walletName: "hybridBalance",
      creditedAmount: 0,
      debitedAmount: withdrawAmount,
      transactionRemark: `Withdraw Hybrid Balance - $${withdrawAmount} (Awaiting admin approval)`,
      status: "Pending",
      toAddress: user.walletAddress,
      currentBalance: wallet.hybridBalance,
      metadata: {
        withdrawalType: "HybridBalance",
        requestedAmount: withdrawAmount,
        usdtPortion,
        mainBalancePortion,
      },
    });
    await pendingTx.save();

    return res.status(200).json({
      success: true,
      message: "Withdraw request submitted. Awaiting admin approval.",
      data: {
        transactionId: pendingTx._id,
        requestedAmount: withdrawAmount,
        lockedBalance: withdrawAmount,
        status: "Pending",
      },
    });
  } catch (error) {
    console.error("Hybrid balance withdrawal error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = {
  withdrawUSDT,
  sendWithdrawOTP,
  withdrawHybrid,
  getHybridWithdrawalHistory,
  withdrawHybridBalance,
};
