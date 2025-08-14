const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { performWalletTransaction } = require('../utils/performWalletTransaction');

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
        message: 'Minimum withdrawal amount is $10' 
      });
    }

    const usdAmount = Number(amount);

    // 2. Check for existing pending withdrawal (transaction remark starts with "Withdraw USDT")
    const pendingWithdrawal = await Transaction.findOne({
      userId,
      status: 'Pending',
      transactionRemark: { $regex: '^Withdraw USDT' }
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

    if (wallet.USDTBalance < usdAmount) {
      return res.status(400).json({ 
        success: false,
        message: 'Insufficient USDT balance' 
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
      transactionRemark: { $regex: '^Withdraw USDT' },
      walletName: 'USDTBalance',
      status: 'Completed',
      createdAt: {
        $gte: startOfDay,
        $lte: endOfDay
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
      -usdAmount,
      'USDTBalance',
      'Withdraw USDT - Withdraw USDT',
      'Pending'
    );

    res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        USDRequested: usdAmount,
        status: 'Pending'
      }
    });
  } catch (error) {
    console.error('Withdraw USDT error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Internal Server Error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  withdrawUSDT
};