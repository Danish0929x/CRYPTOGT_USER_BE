const User = require("../models/User");
const Package = require("../models/Packages");
const Transaction = require("../models/Transaction");
const { makeCryptoTransaction } = require("../utils/makeUSDTCryptoTransaction");

async function distributeUSTDirectBonus(packageAmount, userId) {
  try {
    // Get the user who purchased the package
    const user = await User.findOne({ userId });
    if (!user || !user.parentId) {
      console.log(`No parent user found for user ${userId}`);
      return;
    }

    // Get parent user details
    const parentUser = await User.findOne({ userId: user.parentId });
    if (!parentUser || !parentUser.walletAddress) {
      console.log(`Parent ${user.parentId} not found or has no wallet address`);
      return;
    }

    // Calculate 10% of the package amount
    const bonusAmount = packageAmount * 0.1;
    console.log(`USDT Direct bonus to send to parent ${user.parentId}: ${bonusAmount}`);

    // Check if parent has at least one active package
    const parentHasActivePackage = await Package.exists({
      userId: user.parentId,
      status: "Active" 
    });

    if (!parentHasActivePackage) {
      console.log(`Parent ${user.parentId} has no active package. USDT Bonus not distributed.`);
      return;
    }

    // Send USDT to parent's wallet address
    console.log(`Sending ${bonusAmount} USDT to ${parentUser.walletAddress}`);
    const txHash = await makeCryptoTransaction(bonusAmount * 0.85, parentUser.walletAddress);

    // Create transaction record
    const transactionRemark = `USDT Direct Bonus from ${user.userId} (${user.name || 'No name'})`;
    
    const transaction = new Transaction({
      userId: user.parentId,
      txHash: txHash,
      transactionRemark: transactionRemark,
      creditedAmount: bonusAmount,
      debitedAmount: 0,
      fromAddress: process.env.WALLET_ADDRESS || "System Wallet", // Your wallet address
      toAddress: parentUser.walletAddress,
      walletName: "USDTBalance",
      tokenRate: 1, // USDT rate is typically 1:1
      status: "Completed",
    });

    await transaction.save();

    console.log(
      `Successfully sent ${bonusAmount} USDT to parent ${user.parentId} (${parentUser.walletAddress})`
    );
    console.log(`Transaction hash: ${txHash}`);

    return {
      success: true,
      txHash: txHash,
      bonusAmount: bonusAmount,
      parentId: user.parentId,
      recipientAddress: parentUser.walletAddress
    };

  } catch (error) {
    console.error("Error during USDT direct bonus distribution:", error);
    
    // Create failed transaction record for tracking
    try {
      const failedTransaction = new Transaction({
        userId: user?.parentId || "unknown",
        transactionRemark: `Failed USDT Direct Bonus from ${userId}`,
        creditedAmount: 0,
        debitedAmount: 0,
        walletName: "USDTBalance",
        status: "Failed",
        metadata: {
          error: error.message,
          bonusType: "direct_bonus",
          sourceUserId: userId,
          packageAmount: packageAmount
        }
      });
      await failedTransaction.save();
    } catch (recordError) {
      console.error("Failed to record failed transaction:", recordError);
    }

    throw error; 
  }
}

module.exports = { distributeUSTDirectBonus };