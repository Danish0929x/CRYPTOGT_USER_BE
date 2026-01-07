const Transaction = require("../models/Transaction");
const Wallet = require("../models/Wallet");

/**
 * Perform a credit or debit against the user's wallet balance (USDTBalance, autopoolBalance, or utilityBalance),
 * then log it as a Transaction.
 *
 * @param {String} userId
 * @param {Number|String} amount      Positive to credit, negative to debit
 * @param {String} walletName         Either 'USDTBalance', 'autopoolBalance' or 'utilityBalance'
 * @param {String} transactionRemark
 * @param {String} status             e.g. "Pending" or "Completed"
 * @returns {Promise<Transaction>}
 */
async function performWalletTransaction(
  userId,
  amount,
  walletName,
  transactionRemark,
  status,
  {
    fromAddress = undefined,
    txHash = undefined,
    toAddress = undefined,
    blockNumber = undefined,
    metadata = undefined
  } = {}
) {
  const amt = Number(amount);
  if (isNaN(amt)) throw new Error("Invalid amount");

  // Validate wallet name against current model
  if (!["USDTBalance", "autopoolBalance", "utilityBalance", "hybridBalance"].includes(walletName)) {
    throw new Error("Invalid wallet name. Must be 'USDTBalance', 'autopoolBalance', 'utilityBalance' or 'hybridBalance'");
  }

  const userWallet = await Wallet.findOne({ userId });
  if (!userWallet) throw new Error("User's wallet not found");

  // For debits on Pending/Completed, enforce balance check
  if ((status === "Completed" || status === "Pending") && amt < 0) {
    if (userWallet[walletName] < Math.abs(amt)) {
      throw new Error("Insufficient balance for the debit transaction");
    }
  }

  // Apply balance change immediately for Pending/Completed
  if (status === "Completed" || status === "Pending") {
    userWallet[walletName] += amt;
    // Ensure proper rounding as per Wallet model's pre-save hook
    userWallet[walletName] = Number(userWallet[walletName].toFixed(5));
    await userWallet.save();
  }

  const tx = new Transaction({
    userId,
    transactionRemark,
    creditedAmount: amt > 0 ? amt : 0,
    debitedAmount: amt < 0 ? Math.abs(amt) : 0,
    walletName,
    status,
    currentBalance: userWallet[walletName],
    fromAddress,
    toAddress,
    blockNumber,
    txHash,
    metadata
  });

  return tx.save();
}

/**
 * Change a transaction's status. If marking a previous debit as "Failed",
 * refund that amount back into the correct wallet field.
 *
 * @param {String} transactionId
 * @param {String} newStatus         e.g. "Failed" | "Completed"
 * @returns {Promise<Transaction>}
 */
async function updateTransactionStatus(transactionId, newStatus) {
  const tx = await Transaction.findById(transactionId);
  if (!tx) throw new Error("Transaction not found");

  // On transition to Failed, if it was a debit, refund it
  if (newStatus === "Failed" && tx.debitedAmount > 0 && tx.status !== "Failed") {
    const userWallet = await Wallet.findOne({ userId: tx.userId });
    if (!userWallet) throw new Error("User's wallet not found");

    if (!["USDTBalance", "autopoolBalance", "utilityBalance", "hybridBalance"].includes(tx.walletName)) {
      throw new Error("Invalid walletName in transaction");
    }

    userWallet[tx.walletName] += tx.debitedAmount;
    // Ensure proper rounding as per Wallet model's pre-save hook
    userWallet[tx.walletName] = Number(userWallet[tx.walletName].toFixed(5));
    await userWallet.save();

    tx.currentBalance = userWallet[tx.walletName];
  }

  tx.status = newStatus;
  return tx.save();
}

module.exports = {
  performWalletTransaction,
  updateTransactionStatus,
};