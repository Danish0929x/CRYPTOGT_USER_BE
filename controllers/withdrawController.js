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

    // 1. Validate amount
    if (!amount || isNaN(amount) || Number(amount) < 10) {
      return res.status(400).json({ error: 'Minimum withdrawal amount is $10' });
    }

    const usdAmount = Number(amount);
    const liveRate = await getLiveRate();

    if (!liveRate || liveRate <= 0) {
      return res.status(500).json({ error: 'Live rate not available. Please try again later.' });
    }

    const cgtToWithdraw = parseFloat((usdAmount / liveRate).toFixed(5)); // CGT value

    // 2. Find wallet
    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    if (wallet.CGTBalance < cgtToWithdraw) {
      return res.status(400).json({ error: 'Insufficient CGT balance' });
    }

    // 3. Check if user already withdrew today
    const now = new Date();
    const withdrawnToday = await Transaction.findOne({
      userId,
      debitedAmount: { $gt: 0 },
      transactionRemark: 'CGT Withdraw - Dollar Equivalent Withdrawal',
      walletName: 'CGTBalance',
      $expr: {
        $and: [
          { $eq: [{ $year: "$createdAt" }, now.getFullYear()] },
          { $eq: [{ $month: "$createdAt" }, now.getMonth() + 1] },
          { $eq: [{ $dayOfMonth: "$createdAt" }, now.getDate()] }
        ]
      }
    });

    if (withdrawnToday) {
      return res.status(400).json({ error: 'You can only withdraw once per day' });
    }

    // 4. Perform transaction
    await performWalletTransaction(
      userId,
      -cgtToWithdraw,
      'CGTBalance',
      'CGT Withdraw - Dollar Equivalent Withdrawal',
      'Pending'
    );

    res.status(200).json({
      message: 'Withdrawal request submitted successfully',
      CGTAmount: cgtToWithdraw,
      USDRequested: usdAmount,
      liveRate
    });
  } catch (error) {
    console.error('Withdraw CGT error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

module.exports = {
  withdrawCGT
};
