const User = require("../models/User");
const Package = require("../models/Packages");

// Get referral details by ID
async function getReferralDetails(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const user = await User.findOne({ userId: id });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "User details fetched successfully",
      data: {
        name: user.name,
        userId: user.userId,
      },
    });
  } catch (error) {
    console.error("Error fetching user details:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

// Get user's referral network
// Get user's referral network
async function getReferralNetwork(req, res) {
  const userId = req.user.userId; // Assuming authenticated user
  const { depthLimit } = req.body; // Required depth from request body

  try {
    const user = await User.findOne({ userId: userId });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const referrals = await getNetworkTree(userId, depthLimit);

    const formattedReferrals = referrals.map((ref, index) => ({
      userId: ref.userId || "none",
      name: ref.name || "Anonymous",
      level: ref.level,
      investment: ref.investment || 0,
      joinDate: ref.createdAt || "none"
    }));

    res.status(200).json({
      success: true,
      message: "Referral network fetched successfully",
      data: formattedReferrals,
      total: formattedReferrals.length
    });

  } catch (error) {
    console.error("Error fetching referral network:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching referral network",
      error: error.message
    });
  }
}

// Helper function to build referral network tree
async function getNetworkTree(rootUserId, depth) {
  const pipeline = [
    {
      $match: { userId: rootUserId }
    },
    {
      $graphLookup: {
        from: "users",
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "parentId",
        maxDepth: depth - 1,
        depthField: "networkLevel",  // Changed from "level" to avoid confusion
        as: "network"
      }
    },
    { $unwind: "$network" },
    // Include all levels but adjust numbering
    {
      $addFields: {
        "level": { $add: ["$network.networkLevel", 1] }  // Convert to 1-based indexing
      }
    },
    {
      $lookup: {
        from: "packages",
        localField: "network.userId",
        foreignField: "userId",
        as: "packages"
      }
    },
    {
      $addFields: {
        activePackage: {
          $filter: {
            input: "$packages",
            as: "pkg",
            cond: { $eq: ["$$pkg.status", "Active"] }
          }
        }
      }
    },
    {
      $project: {
        userId: "$network.userId",
        name: "$network.name",
        walletAddress: "$network.walletAddress",
        parentId: "$network.parentId",
        status: "$network.status",
        level: 1,  // Our adjusted level (1-based)
        originalLevel: "$network.networkLevel",  // Keep original for reference
        createdAt: "$network.createdAt",
        package: { $ifNull: [{ $arrayElemAt: ["$activePackage.name", 0] }, "None"] },
        investment: { $ifNull: [{ $arrayElemAt: ["$activePackage.packageAmount", 0] }, 0] }
      }
    },
    { $sort: { level: 1, createdAt: 1 } }
  ];

  try {
    return await User.aggregate(pipeline);
  } catch (error) {
    console.error("Error building network tree:", error);
    throw error;
  }
}
// Get referral statistics
async function getReferralStats(req, res) {
  const { userId } = req.user;

  try {
    const [directReferrals, totalNetwork, activeInvestors] = await Promise.all([
      User.countDocuments({ parentId: userId }),
      getNetworkTree(userId, 10).then(res => res.length),
      Package.countDocuments({ userId, status: "true" })
    ]);

    res.status(200).json({
      success: true,
      message: "Referral stats fetched successfully",
      data: {
        directReferrals,
        totalNetwork,
        activeInvestors,
        levels: 10 // Default max levels considered
      }
    });

  } catch (error) {
    console.error("Error fetching referral stats:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

module.exports = {
  getReferralDetails,
  getReferralNetwork,
  getReferralStats
};