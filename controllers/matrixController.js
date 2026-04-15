const MatrixPackage = require("../models/MatrixPackage");
const HybridPackage = require("../models/HybridPackage");
const User = require("../models/User");

// Children required per part
const CHILDREN_REQUIRED = { 1: 2, 2: 3, 3: 4 };

// Stage config matching frontend HYBRID_MATRICES
const STAGE_CONFIG = [
  { hm: 1, part: 1, entry: 5, income: 2 },
  { hm: 1, part: 2, entry: 8, income: 9 },
  { hm: 1, part: 3, entry: 15, income: 20 },
  { hm: 2, part: 1, entry: 40, income: 20 },
  { hm: 2, part: 2, entry: 60, income: 30 },
  { hm: 2, part: 3, entry: 150, income: 100 },
  { hm: 3, part: 1, entry: 500, income: 200 },
  { hm: 3, part: 2, entry: 800, income: 400 },
  { hm: 3, part: 3, entry: 2000, income: 2000 },
  { hm: 4, part: 1, entry: 6000, income: 2000 },
  { hm: 4, part: 2, entry: 10000, income: 10000 },
  { hm: 4, part: 3, entry: 20000, income: 30000 },
  { hm: 5, part: 1, entry: 50000, income: 20000 },
  { hm: 5, part: 2, entry: 80000, income: 40000 },
  { hm: 5, part: 3, entry: 200000, income: 200000 },
  { hm: 6, part: 1, entry: 600000, income: 400000 },
  { hm: 6, part: 2, entry: 800000, income: 1200000 },
  { hm: 6, part: 3, entry: 1200000, income: 4800000 },
];

// Get next stage after current
const getNextStage = (hm, part) => {
  if (part < 3) return { hm, part: part + 1 };
  if (hm < 6) return { hm: hm + 1, part: 1 };
  return null;
};

// User enters matrix — starts at HM1 P1
// Called when a user gets 2 direct hybrid referrals (matrixLeft + matrixRight filled)
// Only the qualifying user enters — placed sequentially, auto-assigned as child to
// the earliest parent who still needs children in HM1-P1
const enterMatrix = async (userId) => {
  try {
    const existing = await MatrixPackage.findOne({ userId, hm: 1, part: 1 });
    if (existing) return { success: false, message: "Already in matrix", data: existing };

    // placeInStage with skipAutoAssign=false → auto-assigns as child to earliest parent needing children
    const result = await placeInStage(userId, 1, 1);
    if (!result.success) return result;

    return { success: true, message: "User entered matrix", data: result.data };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Place a user in a specific stage (sequential position)
// skipAutoAssign = true when called from enterMatrix (children are explicitly assigned)
const placeInStage = async (userId, hm, part, skipAutoAssign = false) => {
  try {
    const existing = await MatrixPackage.findOne({ userId, hm, part });
    if (existing) return { success: false, message: "Already in this stage", data: existing };

    // Find next sequential position for this stage
    const highestInStage = await MatrixPackage.findOne({ hm, part })
      .sort({ position: -1 })
      .select("position")
      .lean();

    const newPosition = (highestInStage?.position || 0) + 1;

    const entry = new MatrixPackage({
      userId,
      hm,
      part,
      position: newPosition,
      children: [],
      status: "Active",
    });

    await entry.save();

    if (!skipAutoAssign) {
      // Find a parent who needs children in this stage
      const required = CHILDREN_REQUIRED[part];
      const parent = await MatrixPackage.findOne({
        hm,
        part,
        status: "Active",
        _id: { $ne: entry._id },
        $expr: { $lt: [{ $size: "$children" }, required] },
      }).sort({ position: 1 });

      if (parent) {
        entry.parentPackageId = parent._id;
        await entry.save();
        await addChildToParent(parent._id, entry._id, hm, part);
      }
    }

    return { success: true, data: entry };
  } catch (error) {
    return { success: false, message: error.message };
  }
};

// Add child to parent and check completion
const addChildToParent = async (parentId, childId, hm, part) => {
  const parent = await MatrixPackage.findById(parentId);
  if (!parent) return;

  const required = CHILDREN_REQUIRED[part];
  if (parent.children.length >= required) return;

  if (!parent.children.includes(childId)) {
    parent.children.push(childId);
    await parent.save();
  }

  if (parent.children.length >= required) {
    await checkAndPromote(parentId);
  }
};

// Check if a user completed a stage and promote to next
const checkAndPromote = async (packageId) => {
  const pkg = await MatrixPackage.findById(packageId);
  if (!pkg || pkg.status === "Completed") return;

  const required = CHILDREN_REQUIRED[pkg.part];
  if (pkg.children.length < required) return;

  pkg.status = "Completed";
  pkg.completedAt = new Date();
  await pkg.save();

  // Promote to next stage
  const next = getNextStage(pkg.hm, pkg.part);
  if (next) {
    await placeInStage(pkg.userId, next.hm, next.part);
  }
};

// Get all matrix stages for a user (for frontend display)
const getMatrixStages = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Single query: get all user's stages + children populated
    const userStages = await MatrixPackage.aggregate([
      { $match: { userId } },
      {
        $lookup: {
          from: "matrixpackages",
          localField: "children",
          foreignField: "_id",
          as: "childrenData",
          pipeline: [
            { $project: { userId: 1, position: 1, status: 1 } },
            {
              $lookup: {
                from: "users",
                localField: "userId",
                foreignField: "userId",
                as: "user",
                pipeline: [{ $project: { name: 1 } }],
              },
            },
            { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
            { $addFields: { name: "$user.name" } },
            { $project: { user: 0 } },
          ],
        },
      },
      { $sort: { hm: 1, part: 1 } },
    ]);

    // Build response with all 15 stages
    const stages = STAGE_CONFIG.map((config) => {
      const userStage = userStages.find(
        (s) => s.hm === config.hm && s.part === config.part
      );

      return {
        hm: config.hm,
        part: config.part,
        entry: config.entry,
        income: config.income,
        childrenRequired: CHILDREN_REQUIRED[config.part],
        joined: !!userStage,
        status: userStage?.status || null,
        position: userStage?.position || null,
        children: userStage?.childrenData || [],
        completedAt: userStage?.completedAt || null,
      };
    });

    res.status(200).json({
      success: true,
      data: stages,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch matrix stages",
      error: error.message,
    });
  }
};

// Get tree for a specific stage (hm + part)
const getMatrixStageTree = async (req, res) => {
  try {
    const userId = req.user.userId;
    const hm = parseInt(req.query.hm);
    const part = parseInt(req.query.part);

    if (!hm || !part || hm < 1 || hm > 6 || part < 1 || part > 3) {
      return res.status(400).json({ success: false, message: "Invalid hm or part" });
    }

    const userPkg = await MatrixPackage.findOne({ userId, hm, part });
    if (!userPkg) {
      return res.status(200).json({
        success: true,
        message: "Not in this stage yet",
        data: null,
      });
    }

    // Get all packages in this stage + user names in one pipeline
    const allInStage = await MatrixPackage.aggregate([
      { $match: { hm, part } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "userId",
          as: "user",
          pipeline: [{ $project: { name: 1, parentId: 1 } }],
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          userId: 1,
          position: 1,
          children: 1,
          status: 1,
          parentPackageId: 1,
          createdAt: 1,
          name: "$user.name",
          parentId: "$user.parentId",
        },
      },
    ]);

    const pkgMap = {};
    allInStage.forEach((p) => {
      pkgMap[p._id.toString()] = p;
    });

    const required = CHILDREN_REQUIRED[part];

    const buildNode = (pkgId) => {
      if (!pkgId) return null;
      const p = pkgMap[pkgId.toString()];
      if (!p) return null;

      const childNodes = [];
      for (let i = 0; i < required; i++) {
        if (p.children[i]) {
          childNodes.push(buildNode(p.children[i]));
        } else {
          childNodes.push(null);
        }
      }

      return {
        userId: p.userId,
        name: p.name || null,
        parentId: p.parentId || null,
        position: p.position,
        status: p.status,
        isCurrentUser: p.userId === userId,
        createdAt: p.createdAt,
        children: childNodes,
      };
    };

    const tree = buildNode(userPkg._id);

    res.status(200).json({
      success: true,
      data: tree,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch stage tree",
      error: error.message,
    });
  }
};

module.exports = {
  enterMatrix,
  placeInStage,
  getMatrixStages,
  getMatrixStageTree,
  CHILDREN_REQUIRED,
  STAGE_CONFIG,
};
