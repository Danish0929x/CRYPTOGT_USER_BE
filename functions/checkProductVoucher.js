const Package = require("../models/Packages");

async function handleDirectMembers(userId, sponsorId) {
  try {
    // Get sponsor's latest package where productVoucher is false and type is "Buy"
    const sponsorLatestPackage = await Package.findOne(
      { 
        userId: sponsorId,
        productVoucher: false,
        type: "Buy"
      },
      {},
      { sort: { 'createdAt': -1 } }
    );

    if (sponsorLatestPackage) {
      // Add new user to sponsor's directMember array
      await Package.findByIdAndUpdate(
        sponsorLatestPackage._id,
        {
          $addToSet: { directMember: userId },
        }
      );

      // Check if the sponsor's package now has 2 or more direct members
      const updatedPackage = await Package.findById(sponsorLatestPackage._id);
      
      if (updatedPackage && updatedPackage.directMember.length >= 2) {
        await Package.findByIdAndUpdate(
          updatedPackage._id,
          {
            $set: { productVoucher: true }
          }
        );
      }
    }
  } catch (error) {
    console.error("Error in handleDirectMembers:", error);
    throw error;
  }
}

module.exports = { handleDirectMembers };