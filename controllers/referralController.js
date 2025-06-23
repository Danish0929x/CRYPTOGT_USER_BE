const User = require("../models/User");
const Package = require("../models/Packages");

// Get referral details by ID
async function getReferralDetails(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Referral ID is required",
      });
    }

    const user = await User.findOne({ parentId: id });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Referral not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Referral details fetched successfully",
      data: {
        name: user.name,
        walletAddress: user.walletAddress,
        userId: user.userId,
        status: user.status
      },
    });
  } catch (error) {
    console.error("Error fetching referral details:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

// Get user's referral network
async function getReferralNetwork(req, res) {
  const { userId } = req.user; // Assuming authenticated user
  const { depth = 3 } = req.query; // Default depth 3 levels

  try {
    const referrals = await getNetworkTree(userId, parseInt(depth));

    const formattedReferrals = referrals.map((ref, index) => ({
      sn: index + 1,
      userId: ref.userId,
      name: ref.name || "Anonymous",
      walletAddress: ref.walletAddress,
      level: ref.level,
      package: ref.package || "None",
      investment: ref.investment || 0,
      joinDate: ref.createdAt,
      status: ref.status
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
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
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
        depthField: "level",
        as: "network"
      }
    },
    { $unwind: "$network" },
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
        level: "$network.level",
        createdAt: "$network.createdAt",
        package: { $ifNull: [{ $arrayElemAt: ["$activePackage.name", 0] }, null] },
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
      Package.countDocuments({ userId, status: "Active" })
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