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
 * Withdraw Hybrid Package
 * Distributes 10 USDT to real wallet, 10 USDT to retopup wallet, 10 USDT (900 CGT) to CGT Homes
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

    // 3. Find package and validate
    const package = await Package.findById(packageId);
    if (!package) {
      return res.status(404).json({
        success: false,
        message: "Package not found",
      });
    }

    // Check package belongs to user
    if (package.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized: This package does not belong to you",
      });
    }

    // Check package type is Hybrid
    if (package.packageType !== "Hybrid") {
      return res.status(400).json({
        success: false,
        message: "Package type must be Hybrid",
      });
    }

    // Check status is Matured
    if (package.status !== "Matured") {
      return res.status(400).json({
        success: false,
        message: "Package must be matured before withdrawal",
        currentStatus: package.status,
      });
    }

    // Check user has a valid wallet address for direct USDT payout
    if (!user.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress)) {
      return res.status(400).json({
        success: false,
        message: "Valid wallet address required for direct USDT withdrawal",
      });
    }

    // 4. Distribute amounts
    const realWalletAmount = 10;
    const retopupWalletAmount = 10;
    const cgtHomesAmount = 10;
    const cgtHomesCoinAmount = 900; // 10 × 90
    const fromWalletAddress = "0x5C28b3979609eF43A2C4B73257d540cd29d9C1F0";

    // Send 10 USDT directly to user's wallet address using makeUSDTCryptoTransaction
    let realWalletTxHash = null;

    try {
      realWalletTxHash = await makeUSDTCryptoTransaction(realWalletAmount, user.walletAddress);
    } catch (cryptoError) {
      
      // Create failed transaction record
      const failedTx = new Transaction({
        userId,
        walletName: "USDTBalance",
        creditedAmount: 0,
        debitedAmount: 0,
        transactionRemark: `Hybrid Package Withdrawal - Failed (Package: ${packageId})`,
        status: "Failed",
        fromAddress: fromWalletAddress,
        toAddress: user.walletAddress,
        metadata: {
          packageId: packageId,
          withdrawalType: "HybridRealWallet",
          error: cryptoError.message,
        },
      });
      await failedTx.save();

      return res.status(500).json({
        success: false,
        message: "Failed to send USDT to your wallet. Withdrawal cancelled.",
        error: cryptoError.message,
      });
    }

    // Create transaction record for real wallet USDT payout (only if successful)
    const realWalletTx = new Transaction({
      userId,
      walletName: "USDTBalance",
      creditedAmount: realWalletAmount,
      debitedAmount: 0,
      transactionRemark: `Hybrid Package Withdrawal - Real Wallet (Package: ${packageId})`,
      status: "Completed",
      txHash: realWalletTxHash,
      fromAddress: fromWalletAddress,
      toAddress: user.walletAddress,
      metadata: {
        packageId: packageId,
        withdrawalType: "HybridRealWallet",
      },
    });
    await realWalletTx.save();

    // Add 10 USDT to retopup wallet (autopoolBalance)
    const retopupWalletTx = await performWalletTransaction(
      userId,
      retopupWalletAmount,
      "autopoolBalance",
      `Hybrid Package Withdrawal - Retopup Wallet (Package: ${packageId})`,
      "Completed",
      {
        metadata: {
          packageId: packageId,
          withdrawalType: "HybridRetopup",
        },
      }
    );

    // Transfer to CGT Homes (900 CGT coins)
    let cgtHomesTransferSuccess = false;
    let cgtHomesError = null;

    try {
      const cgtHomesResponse = await axios.post(
        `${CGT_HOMES_API_URL}/wallet/add-balance`,
        {
          email: user.connectedCGTHomesEmail,
          amount: cgtHomesCoinAmount,
          transactionRemark: `Hybrid Package Withdrawal from CryptoGT - User: ${userId}, Package: ${packageId}`,
          status: "Success",
        }
      );

      if (cgtHomesResponse.data.success) {
        cgtHomesTransferSuccess = true;
      } else {
        cgtHomesError = cgtHomesResponse.data.message || "CGT Homes transfer failed";
        console.error("CGT Homes API error:", cgtHomesResponse.data);
      }
    } catch (apiError) {
      cgtHomesError = apiError.message;
      console.error("Error calling CGT Homes API:", apiError.message);
    }

    // Create transaction record for CGT Homes transfer (no wallet balance change, just record)
    const cgtHomesTx = new Transaction({
      userId,
      walletName: "USDTBalance",
      creditedAmount: 0,
      debitedAmount: 0,
      transactionRemark: `Hybrid Package Withdrawal - CGT Homes Transfer (Package: ${packageId})`,
      status: cgtHomesTransferSuccess ? "Completed" : "Failed",
      metadata: {
        packageId: packageId,
        withdrawalType: "HybridCGTHomes",
        cgtHomesCoinAmount: cgtHomesCoinAmount,
        destinationEmail: user.connectedCGTHomesEmail,
        error: cgtHomesError,
      },
    });
    await cgtHomesTx.save();

    // 5. Update package status to Withdrawn
    package.status = "Inactive";
    await package.save();

    // 6. Return success response
    res.status(200).json({
      success: true,
      message: "Hybrid package withdrawn successfully",
      data: {
        packageId: package._id,
        userId: userId,
        distributions: {
          realWallet: {
            amount: realWalletAmount,
            transactionId: realWalletTx._id,
            status: "Completed",
            txHash: realWalletTxHash,
            toAddress: user.walletAddress,
          },
          retopupWallet: {
            amount: retopupWalletAmount,
            transactionId: retopupWalletTx._id,
            status: "Completed",
          },
          cgtHomes: {
            usdtAmount: cgtHomesAmount,
            cgtCoinAmount: cgtHomesCoinAmount,
            transactionId: cgtHomesTx._id,
            status: cgtHomesTransferSuccess ? "Completed" : "Failed",
            destinationEmail: user.connectedCGTHomesEmail,
            error: cgtHomesError,
          },
        },
        packageStatus: package.status,
        timestamp: new Date(),
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

    // 3. Find wallet and check hybrid balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: "Wallet not found",
      });
    }

    if (wallet.hybridBalance < withdrawAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient hybrid balance",
        availableBalance: wallet.hybridBalance,
      });
    }

    // 4. Check for existing pending withdrawal
    const pendingWithdrawal = await Transaction.findOne({
      userId,
      status: "Pending",
      transactionRemark: { $regex: "^Withdraw Hybrid Balance" },
    });

    if (pendingWithdrawal) {
      return res.status(400).json({
        success: false,
        message: "You already have a pending hybrid withdrawal request",
      });
    }

    // 5. Validate wallet address for USDT transaction
    if (!user.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(user.walletAddress)) {
      return res.status(400).json({
        success: false,
        message: "Valid wallet address required for hybrid withdrawal",
      });
    }

    // 6. Send hybrid amount with distribution
    const { sendHybridAmount } = require("../functions/sendHybridAmount");

    try {
      const result = await sendHybridAmount(withdrawAmount, userId, user.walletAddress);

      // 7. Deduct from hybrid balance
      wallet.hybridBalance -= withdrawAmount;
      await wallet.save();

      // 8. Create transaction record for hybrid balance debit
      const hybridDebitTx = new Transaction({
        userId,
        walletName: "hybridBalance",
        creditedAmount: 0,
        debitedAmount: withdrawAmount,
        transactionRemark: `Withdraw Hybrid Balance - $${withdrawAmount} (50% USDT + 30% Main Balance)`,
        status: "Completed",
        currentBalance: wallet.hybridBalance,
        metadata: {
          withdrawalType: "HybridBalance",
          usdtTransaction: result.usdtTransaction,
          mainBalance: result.mainBalanceCredit,
          txHash: result.txHash,
        },
      });
      await hybridDebitTx.save();

      return res.status(200).json({
        success: true,
        message: "Hybrid balance withdrawal initiated successfully",
        details: {
          withdrawalAmount: withdrawAmount,
          mainBalanceCredit: result.mainBalanceCredit,
          usdtTransaction: result.usdtTransaction,
          txHash: result.txHash,
        },
      });
    } catch (cryptoError) {
      console.error("Error sending hybrid amount:", cryptoError.message);

      // Create failed transaction record
      const failedTx = new Transaction({
        userId,
        walletName: "hybridBalance",
        creditedAmount: 0,
        debitedAmount: withdrawAmount,
        transactionRemark: `Withdraw Hybrid Balance - Failed (Amount: ${withdrawAmount})`,
        status: "Failed",
        metadata: {
          error: cryptoError.message,
        },
      });
      await failedTx.save();

      return res.status(500).json({
        success: false,
        message: "Failed to process hybrid withdrawal",
        error: cryptoError.message,
      });
    }
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
  withdrawHybrid,
  getHybridWithdrawalHistory,
  withdrawHybridBalance,
};
