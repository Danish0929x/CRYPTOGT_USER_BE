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
      joinDate: ref.createdAt || "none",
      rewardStatus: ref.rewardStatus || "none", // Added rewardStatus field
    }));

    res.status(200).json({
      success: true,
      message: "Referral network fetched successfully",
      data: formattedReferrals,
      total: formattedReferrals.length,
    });
  } catch (error) {
    console.error("Error fetching referral network:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching referral network",
      error: error.message,
    });
  }
}

// Helper function to build referral network tree
async function getNetworkTree(rootUserId, depth) {
  const pipeline = [
    {
      $match: { userId: rootUserId },
    },
    {
      $graphLookup: {
        from: "users",
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "parentId",
        maxDepth: depth - 1,
        depthField: "networkLevel",
        as: "network",
      },
    },
    { $unwind: "$network" },
    {
      $addFields: {
        level: { $add: ["$network.networkLevel", 1] },
      },
    },
    {
      $lookup: {
        from: "packages",
        let: { userId: "$network.userId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$userId", "$$userId"] },
              status: { $in: ["Active", "active", "true", true] },
            },
          },
          {
            $group: {
              _id: "$userId",
              totalInvestment: { $sum: "$packageAmount" },
            },
          },
        ],
        as: "investmentData",
      },
    },
    {
      $project: {
        userId: "$network.userId",
        name: "$network.name",
        level: 1,
        createdAt: "$network.createdAt",
        rewardStatus: "$network.rewardStatus", // Added rewardStatus field
        investment: {
          $ifNull: [
            { $arrayElemAt: ["$investmentData.totalInvestment", 0] },
            0,
          ],
        },
      },
    },
    { $sort: { level: 1, createdAt: 1 } },
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
      getNetworkTree(userId, 10).then((res) => res.length),
      Package.countDocuments({
        userId,
        status: "Active",
      }),
    ]);

    res.status(200).json({
      success: true,
      message: "Referral stats fetched successfully",
      data: {
        directReferrals,
        totalNetwork,
        activeInvestors,
        levels: 10, // Default max levels considered
      },
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
    const statusesToExclude = ["User", "Associate", "Team Leader"];

    // Run all aggregations in parallel
    const [
      directActiveMembers,
      selfInvestment,
      directBusiness,
      teamBusiness,
      rewardStatusDetails,
    ] = await Promise.all([
      // 1. Total Direct Active Members (unchanged)
      User.aggregate([
        { $match: { parentId: userId } },
        {
          $lookup: {
            from: "packages",
            localField: "userId",
            foreignField: "userId",
            as: "packages",
          },
        },
        {
          $match: {
            "packages.status": {
              $in: ["Active", "active", "true", true],
            },
          },
        },
        { $count: "count" },
      ]),

      // 2. Self Investment (unchanged)
      Package.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: null,
            total: { $sum: "$packageAmount" },
          },
        },
      ]),

      // 3. Total Direct Business Amount (unchanged)
      Package.aggregate([
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "userId",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $match: {
            "user.parentId": userId,
            status: { $in: ["Active", "active", "true", true] },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$packageAmount" },
          },
        },
      ]),

      // 4. Total Team Business Amount (unchanged)
      Package.aggregate([
        {
          $match: {
            status: { $in: ["Active", "active", "true", true] },
          },
        },
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "userId",
            as: "user",
          },
        },
        { $unwind: "$user" },
        {
          $match: {
            "user.userId": { $ne: userId },
          },
        },
        {
          $graphLookup: {
            from: "users",
            startWith: "$user.parentId",
            connectFromField: "parentId",
            connectToField: "userId",
            as: "network",
            maxDepth: 100,
          },
        },
        {
          $match: {
            "network.userId": userId,
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$packageAmount" },
          },
        },
      ]),

      // 5. Modified to exclude specific statuses and get details
      User.aggregate([
        { $match: { parentId: userId } }, // Start with direct referrals
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "parentId",
            as: "directTeam",
          },
        },
        { $unwind: "$directTeam" },
        {
          $match: {
            "directTeam.rewardStatus": {
              $ne: null,
              $exists: true,
              $nin: statusesToExclude, // Exclude the specified statuses
            },
          },
        },
        {
          $group: {
            _id: {
              directReferralId: "$userId",
              directReferralName: "$name",
              rewardStatus: "$directTeam.rewardStatus",
            },
            members: {
              $push: {
                userId: "$directTeam.userId",
                name: "$directTeam.name",
                rewardStatus: "$directTeam.rewardStatus",
                joinDate: "$directTeam.joinDate",
                investment: "$directTeam.investment",
              },
            },
          },
        },
        {
          $group: {
            _id: "$_id.rewardStatus",
            count: { $sum: 1 },
            directLegs: {
              $push: {
                directReferralId: "$_id.directReferralId",
                directReferralName: "$_id.directReferralName",
                members: "$members",
              },
            },
          },
        },
      ]),
    ]);

    // Get team size separately
    const teamSize = await getNetworkTree(userId, 100).then(
      (res) => res.length
    );

    // Convert reward status details to a more usable format
    const rewardStatusData = {};
    rewardStatusDetails.forEach((item) => {
      rewardStatusData[item._id] = {
        count: item.count,
        directLegs: item.directLegs,
      };
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

        // Only include counts for statuses we care about
        supervisorCount: rewardStatusData["Supervisor"]?.count || 0,
        generalManagerCount: rewardStatusData["General Manager"]?.count || 0,
        directorCount: rewardStatusData["Director"]?.count || 0,
        presidentCount: rewardStatusData["President"]?.count || 0,
        starPresidentCount: rewardStatusData["Star President"]?.count || 0,
        crownStarCount: rewardStatusData["Crown Star"]?.count || 0,
        chairmanCount: rewardStatusData["Chairman"]?.count || 0,

        // Detailed information (already filtered)
        rewardStatusDetails: rewardStatusData,

        // Filtered counts
        allRewardStatusCounts: Object.fromEntries(
          Object.entries(rewardStatusData).map(([status, data]) => [
            status,
            data.count,
          ])
        ),
      },
    });
  } catch (error) {
    console.error("Error in getRankAndReward:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching rank and reward data",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

module.exports = {
  getReferralDetails,
  getReferralNetwork,
  getReferralStats,
  getRankAndReward,
};
