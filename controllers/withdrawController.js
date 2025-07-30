const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { performWalletTransaction } = require('../utils/performWalletTransaction');
const getLiveRate = require('../utils/liveRateUtils');

/**
 * Withdraw CGT equivalent of given USD amount
 */
const withdrawCGT = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount } = req.body; // amount in USD

    // 1. Validate amount (minimum 10 USDT)
    if (!amount || isNaN(amount) || Number(amount) < 10) {
      return res.status(400).json({ 
        success: false,
        message: 'Minimum withdrawal amount is $10' 
      });
    }

    const usdAmount = Number(amount);
    const liveRate = await getLiveRate();

    if (!liveRate || liveRate <= 0) {
      return res.status(500).json({ 
        success: false,
        message: 'Live rate not available. Please try again later.' 
      });
    }

    const cgtToWithdraw = parseFloat((usdAmount / liveRate).toFixed(5)); // CGT value

    // 2. Check for existing pending withdrawal
    const pendingWithdrawal = await Transaction.findOne({
      userId,
      status: 'Pending',
      transactionRemark: 'Withdraw CGT - Dollar Equivalent Withdrawal'
    });

    if (pendingWithdrawal) {
      return res.status(400).json({ 
        success: false,
        message: 'You already have a pending withdrawal request' 
      });
    }

    // 3. Find wallet and check balance
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ 
        success: false,
        message: 'Wallet not found' 
      });
    }

    if (wallet.USDTBalance < cgtToWithdraw) {
      return res.status(400).json({ 
        success: false,
        message: 'Insufficient USDT balance' 
      });
    }

    // 4. Check if user already withdrew today (completed withdrawals)
    const now = new Date();
    const withdrawnToday = await Transaction.findOne({
      userId,
      debitedAmount: { $gt: 0 },
      transactionRemark: 'Withdraw CGT - Dollar Equivalent Withdrawal',
      walletName: 'USDTBalance',
      status: 'Completed',
      $expr: {
        $and: [
          { $eq: [{ $year: "$createdAt" }, now.getFullYear()] },
          { $eq: [{ $month: "$createdAt" }, now.getMonth() + 1] },
          { $eq: [{ $dayOfMonth: "$createdAt" }, now.getDate()] }
        ]
      }
    });

    if (withdrawnToday) {
      return res.status(400).json({ 
        success: false,
        message: 'You can only withdraw once per day' 
      });
    }

    // 5. Perform transaction
    await performWalletTransaction(
      userId,
      -cgtToWithdraw,
      'USDTBalance',
      'Withdraw CGT - Dollar Equivalent Withdrawal',
      'Pending'
    );

    res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        CGTAmount: cgtToWithdraw,
        USDRequested: usdAmount,
        liveRate,
        status: 'Pending'
      }
    });
  } catch (error) {
    console.error('Withdraw CGT error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal Server Error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  withdrawCGT
};