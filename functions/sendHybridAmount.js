const Wallet = require("../models/Wallet");
const Transaction = require("../models/Transaction");
const { makeCryptoTransaction } = require("../utils/makeUSDTCryptoTransaction");
const { performWalletTransaction } = require("../utils/performWalletTransaction");

/**
 * Send hybrid amount with distribution:
 * - 50% goes to USDT crypto transaction (direct wallet)
 * - 30% goes to main balance (USDTBalance)
 *
 * @param {number} amount - The hybrid amount to withdraw
 * @param {string} userId - User ID
 * @param {string} walletAddress - User's wallet address for USDT transaction
 * @returns {Promise<object>} - Result with distribution details
 */
async function sendHybridAmount(amount, userId, walletAddress) {
  try {
    // Calculate distribution
    const usdtTransactionAmount = amount * 0.50;  // 50% to USDT
    const mainBalanceAmount = amount * 0.30;     // 30% to main balance

    // 1. Send USDT to user's wallet (50%)
    let txHash = null;
    try {
      txHash = await makeCryptoTransaction(usdtTransactionAmount.toFixed(2), walletAddress);
    } catch (cryptoError) {
      throw new Error(`Failed to send USDT: ${cryptoError.message}`);
    }

    // 2. Create one withdrawal transaction that:
    //    - Credits main balance with 30%
    //    - Records USDT 50% in metadata
    await performWalletTransaction(
      userId,
      mainBalanceAmount,  // Credit 30% to main balance
      "USDTBalance",
      `Withdraw Hybrid Balance - $${amount} (50% USDT + 30% Main Balance)`,
      "Completed",
      {
        txHash: txHash,
        toAddress: walletAddress,
        metadata: {
          withdrawalType: "HybridBalance",
          totalWithdrawal: amount,
          distribution: {
            usdtTransaction: usdtTransactionAmount,
            mainBalance: mainBalanceAmount,
          },
        },
      }
    );

    return {
      success: true,
      mainBalanceCredit: mainBalanceAmount,
      usdtTransaction: usdtTransactionAmount,
      txHash: txHash,
      message: "Hybrid amount distributed successfully",
    };
  } catch (error) {
    throw error;
  }
}

module.exports = { sendHybridAmount };
