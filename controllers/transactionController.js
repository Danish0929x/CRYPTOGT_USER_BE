const Transaction = require("../models/Transaction");

exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { transactionRemark, walletName, type } = req.body;

    const query = { userId };

    // Filter by transaction remark (prefix match, case insensitive)
    if (transactionRemark) {
      query.transactionRemark = { 
        $regex: `^${transactionRemark}`, 
        $options: 'i' 
      };
    }

    // Filter by wallet name (exact match from enum values)
    if (walletName) {
      query.walletName = walletName; // Exact match for enum field
    }

    // Filter by transaction type
    if (type === 'credited') {
      query.creditedAmount = { $gt: 0 };
    } else if (type === 'debited') {
      query.debitedAmount = { $gt: 0 };
    }

    // Get transactions sorted by newest first
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .limit(500);

    res.status(200).json({ 
      success: true, 
      message: "Transactions fetched successfully",
      data: transactions 
    });

  } catch (err) {
    console.error("Transaction fetch error:", err);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: err.message 
    });
  }
};