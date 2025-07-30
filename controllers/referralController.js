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

    const formattedReferrals = referrals.map((ref) => ({
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
        depthField: "networkLevel",
        as: "network"
      }
    },
    { $unwind: "$network" },
    {
      $addFields: {
        level: { $add: ["$network.networkLevel", 1] }
      }
    },
    {
      $lookup: {
        from: "packages",
        let: { userId: "$network.userId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$userId", "$$userId"] },
              status: "Active"
            }
          },
          {
            $group: {
              _id: "$userId",
              totalInvestment: { $sum: "$packageAmount" }
            }
          }
        ],
        as: "investmentData"
      }
    },
    {
      $project: {
        userId: "$network.userId",
        name: "$network.name",
        level: 1,
        createdAt: "$network.createdAt",
        investment: {
          $ifNull: [{ $arrayElemAt: ["$investmentData.totalInvestment", 0] }, 0]
        }
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
      Package.countDocuments({ 
        userId, 
        status: "Active"
      })
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



async function getRankAndReward(req, res) {
  try {
    const userId = req.user.userId;

    // 1. Total Direct Active Members (direct referrals with active packages)
    const directActiveMembers = await User.aggregate([
      { $match: { parentId: userId } },
      {
        $lookup: {
          from: "packages",
          localField: "userId",
          foreignField: "userId",
          as: "packages"
        }
      },
      {
        $match: {
          $or: [
            { "packages.status": "Active" },
            { "packages.status": "active" },
            { "packages.status": "true" },
            { "packages.status": true }
          ]
        }
      },
      { $count: "count" }
    ]);

    // 2. Self Investment (sum of ALL user's packages - both active and inactive)
    const selfInvestment = await Package.aggregate([
      { $match: { userId } }, // Removed status filter
      {
        $group: {
          _id: null,
          total: { $sum: "$packageAmount" }
        }
      }
    ]);

    // 3. Total Direct Business Amount (sum of direct referrals' active packages)
    const directBusiness = await Package.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "userId",
          as: "user"
        }
      },
      { $unwind: "$user" },
      { $match: { 
        "user.parentId": userId, 
        $or: [
          { status: "Active" },
          { status: "active" },
          { status: "true" },
          { status: true }
        ]
      } },
      {
        $group: {
          _id: null,
          total: { $sum: "$packageAmount" }
        }
      }
    ]);

    // 4. Total Team Size (all referrals at any level)
    const teamSize = await getNetworkTree(userId, 100).then(res => res.length);

    // 5. Total Team Business Amount (all referrals' active packages)
    const teamBusiness = await Package.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "userId",
          as: "user"
        }
      },
      { $unwind: "$user" },
      { 
        $match: { 
          "user.parentId": { $ne: null }, // Exclude root user
          $or: [
            { status: "Active" },
            { status: "active" },
            { status: "true" },
            { status: true }
          ]
        } 
      },
      {
        $graphLookup: {
          from: "users",
          startWith: "$user.parentId",
          connectFromField: "parentId",
          connectToField: "userId",
          as: "network",
          maxDepth: 100
        }
      },
      {
        $match: {
          "network.userId": userId
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$packageAmount" }
        }
      }
    ]);

    // 6. Direct RewardStatus Counts - Count direct referrals by their rewardStatus
    const directRewardStatusCounts = await User.aggregate([
      { $match: { parentId: userId } },
      {
        $group: {
          _id: "$rewardStatus",
          count: { $sum: 1 }
        }
      }
    ]);

    // Convert array to object for easier access
    const rewardStatusMap = {};
    directRewardStatusCounts.forEach(item => {
      rewardStatusMap[item._id] = item.count;
    });

    res.status(200).json({
      success: true,
      message: "Rank and reward data fetched successfully",
      data: {
        totalDirectActiveMembers: directActiveMembers[0]?.count || 0,
        selfInvestment: selfInvestment[0]?.total || 0,
        totalDirectBusinessAmount: directBusiness[0]?.total || 0,
        totalTeamSize: teamSize,
        totalTeamBusinessAmount: teamBusiness[0]?.total || 0,
        
        // Direct RewardStatus counts for rank progression requirements
        directSupervisors: rewardStatusMap["Supervisor"] || 0,
        directGeneralManagers: rewardStatusMap["General Manager"] || 0,
        directDirectors: rewardStatusMap["Director"] || 0,
        directPresidents: rewardStatusMap["President"] || 0,
        directStarPresidents: rewardStatusMap["Star President"] || 0,
        directCrownStars: rewardStatusMap["Crown Star"] || 0,
        
        // Additional counts for other ranks (optional)
        directUsers: rewardStatusMap["User"] || 0,
        directAssociates: rewardStatusMap["Associate"] || 0,
        directTeamLeaders: rewardStatusMap["Team Leader"] || 0,
        directChairman: rewardStatusMap["Chairman"] || 0,
        
        // Complete breakdown for debugging/admin purposes
        allDirectRewardStatusCounts: rewardStatusMap
      }
    });

  } catch (error) {
    console.error("Error in getRankAndReward:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching rank and reward data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
}





module.exports = {
  getReferralDetails,
  getReferralNetwork,
  getReferralStats,
  getRankAndReward
};