const User = require("../models/User");
const Package = require("../models/Packages");
const { performWalletTransaction } = require("../utils/performWalletTransaction");

async function distributeDirectBonus(packageAmount, userId) {
  try {
    // Get the user who purchased the package
    const user = await User.findOne({ userId });
    if (!user || !user.parentId) {
      console.log(`No parent user found for user ${userId}`);
      return;
    }

    // Calculate 10% of the package amount
    const bonusAmount = packageAmount * 0.1;
    console.log(`Direct bonus to add to parent ${user.parentId}: ${bonusAmount}`);

    // Prepare transaction remark
    const transactionRemark = `Direct Bonus from ${user.userId} (${user.name || 'No name'})`;
   
    // Check if parent has at least one active package
    const parentHasActivePackage = await Package.exists({
      userId: user.parentId,
      status: "Active" 
    });

    if (!parentHasActivePackage) {
      console.log(`Parent ${user.parentId} has no active package. Bonus not distributed.`);
      return;
    }

    // Distribute bonus to parent's CGTBalance
    await performWalletTransaction(
      user.parentId, // Parent's userId
      bonusAmount,
      "USDTBalance", 
      transactionRemark,
      "Completed"
    );

    console.log(
      `Added ${bonusAmount} USDT to parent ${user.parentId}'s wallet`
    );
  } catch (error) {
    console.error("Error during direct bonus distribution:", error);
    // Consider adding more detailed error logging here
    throw error; 
  }
}

module.exports = { distributeDirectBonus };