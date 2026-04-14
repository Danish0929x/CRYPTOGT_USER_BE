const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

// ── Separate test DB connection (CryptographyTest) ──
let testConn = null;
let TestUser = null;
let TestHybridPackage = null;
let TestMatrixPackage = null;

const getTestConnection = async () => {
  if (testConn && testConn.readyState === 1) return testConn;

  const prodUri = process.env.MONGO_URI;
  const testUri = prodUri.replace(/\/([^/?]+)(\?|$)/, "/CryptographyTest$2");

  testConn = await mongoose.createConnection(testUri).asPromise();
  console.log("Connected to TEST database:", testConn.name);

  const userSchema = require("../models/User").schema;
  const hybridSchema = require("../models/HybridPackage").schema;
  const matrixSchema = require("../models/MatrixPackage").schema;

  TestUser = testConn.model("User", userSchema);
  TestHybridPackage = testConn.model("HybridPackage", hybridSchema);
  TestMatrixPackage = testConn.model("MatrixPackage", matrixSchema);

  return testConn;
};

const ensureTestModels = async () => {
  await getTestConnection();
  return { TestUser, TestHybridPackage, TestMatrixPackage };
};

// ── Stage config ──
const STAGE_CONFIG = [
  { hm: 1, part: 1, entry: 5, income: 2 },
  { hm: 1, part: 2, entry: 8, income: 12 },
  { hm: 1, part: 3, entry: 20, income: 100 },
  { hm: 2, part: 1, entry: 60, income: 20 },
  { hm: 2, part: 2, entry: 100, income: 100 },
  { hm: 2, part: 3, entry: 300, income: 1500 },
  { hm: 3, part: 1, entry: 900, income: 300 },
  { hm: 3, part: 2, entry: 1500, income: 2000 },
  { hm: 3, part: 3, entry: 4000, income: 22000 },
  { hm: 4, part: 1, entry: 10000, income: 5000 },
  { hm: 4, part: 2, entry: 15000, income: 20000 },
  { hm: 4, part: 3, entry: 40000, income: 220000 },
  { hm: 5, part: 1, entry: 100000, income: 50000 },
  { hm: 5, part: 2, entry: 150000, income: 200000 },
  { hm: 5, part: 3, entry: 400000, income: 3200000 },
];

// ── Matrix logic (uses test DB models) ──
const CHILDREN_REQUIRED = { 1: 2, 2: 3, 3: 4 };

const getNextStage = (hm, part) => {
  if (part < 3) return { hm, part: part + 1 };
  if (hm < 5) return { hm: hm + 1, part: 1 };
  return null;
};

const testPlaceInStage = async (userId, hm, part, skipAutoAssign = false) => {
  const existing = await TestMatrixPackage.findOne({ userId, hm, part });
  if (existing) return { success: false, data: existing };

  const highestInStage = await TestMatrixPackage.findOne({ hm, part })
    .sort({ position: -1 }).select("position").lean();
  const newPosition = (highestInStage?.position || 0) + 1;

  const entry = new TestMatrixPackage({
    userId, hm, part, position: newPosition, children: [], status: "Active",
  });
  await entry.save();

  if (!skipAutoAssign) {
    const required = CHILDREN_REQUIRED[part];
    const parent = await TestMatrixPackage.findOne({
      hm, part, status: "Active", _id: { $ne: entry._id },
      $expr: { $lt: [{ $size: "$children" }, required] },
    }).sort({ position: 1 });

    if (parent) {
      entry.parentPackageId = parent._id;
      await entry.save();
      await testAddChildToParent(parent._id, entry._id, hm, part);
    }
  }

  return { success: true, data: entry };
};

const testAddChildToParent = async (parentId, childId, hm, part) => {
  const parent = await TestMatrixPackage.findById(parentId);
  if (!parent) return;
  const required = CHILDREN_REQUIRED[part];
  if (parent.children.length >= required) return;
  if (!parent.children.includes(childId)) {
    parent.children.push(childId);
    await parent.save();
  }
  if (parent.children.length >= required) {
    await testCheckAndPromote(parentId);
  }
};

const testCheckAndPromote = async (packageId) => {
  const pkg = await TestMatrixPackage.findById(packageId);
  if (!pkg || pkg.status === "Completed") return;
  const required = CHILDREN_REQUIRED[pkg.part];
  if (pkg.children.length < required) return;
  pkg.status = "Completed";
  pkg.completedAt = new Date();
  await pkg.save();
  const next = getNextStage(pkg.hm, pkg.part);
  if (next) await testPlaceInStage(pkg.userId, next.hm, next.part);
};

const testEnterMatrix = async (userId) => {
  console.log(`[MATRIX] testEnterMatrix called for: ${userId}`);
  const existing = await TestMatrixPackage.findOne({ userId, hm: 1, part: 1 });
  if (existing) {
    console.log(`[MATRIX] ${userId} already in matrix, skipping`);
    return;
  }

  console.log(`[MATRIX] Placing ${userId} in HM1-P1`);
  await testPlaceInStage(userId, 1, 1);
};

// ── API Endpoints ──

exports.createTestUser = async (req, res) => {
  try {
    await ensureTestModels();
    const { userId, name, parentId } = req.body;

    if (!userId || !name || !parentId) {
      return res.status(400).json({ success: false, message: "userId, name, parentId are required" });
    }

    const existing = await TestUser.findOne({ userId });
    if (existing) {
      return res.status(400).json({ success: false, message: `User ${userId} already exists` });
    }

    if (parentId !== "SYSTEM") {
      const parent = await TestUser.findOne({ userId: parentId });
      if (!parent) {
        return res.status(400).json({ success: false, message: `Parent ${parentId} not found` });
      }
    }

    const user = new TestUser({
      userId, name, parentId,
      walletAddress: `0xTEST_${userId}_${Date.now()}`,
      rewardStatus: "User",
    });
    await user.save();

    res.status(201).json({ success: true, message: `User ${name} (${userId}) created`, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.joinTestHybrid = async (req, res) => {
  try {
    await ensureTestModels();
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }

    const user = await TestUser.findOne({ userId });
    if (!user) {
      return res.status(400).json({ success: false, message: `User ${userId} not found` });
    }

    const existingPkg = await TestHybridPackage.findOne({ userId });
    if (existingPkg) {
      return res.status(400).json({ success: false, message: `User ${userId} already has hybrid package` });
    }

    const allPackages = await TestHybridPackage.find().select("position leftChildId rightChildId").lean();
    const existingPositions = new Set(allPackages.map((p) => p.position));
    const highestPosition = allPackages.length > 0 ? Math.max(...allPackages.map((p) => p.position)) : 0;
    const positionMap = {};
    allPackages.forEach((p) => { positionMap[p.position] = p; });

    let newPosition = null;
    let parentPackageId = null;
    const startPosition = existingPositions.has(1) ? 2 : 1;

    for (let pos = startPosition; pos <= highestPosition + 2; pos++) {
      if (!existingPositions.has(pos)) {
        const parentPos = Math.floor(pos / 2);
        if (parentPos === 0) { newPosition = pos; break; }
        const parentPkg = positionMap[parentPos];
        if (parentPkg) {
          const isLeftChild = pos % 2 === 0;
          const slotIsEmpty = isLeftChild ? !parentPkg.leftChildId : !parentPkg.rightChildId;
          if (slotIsEmpty) { newPosition = pos; parentPackageId = parentPkg._id; break; }
        }
      }
    }

    if (!newPosition) {
      newPosition = highestPosition + 1;
      const parentPos = Math.floor(newPosition / 2);
      const parentPkg = await TestHybridPackage.findOne({ position: parentPos });
      parentPackageId = parentPkg?._id || null;
    }

    const newHybridPackage = new TestHybridPackage({
      userId, position: newPosition, parentPackageId,
      txnId: `test_txn_${userId}_${Date.now()}`, status: "Active",
    });
    await newHybridPackage.save();

    if (parentPackageId) {
      const parentPackage = await TestHybridPackage.findById(parentPackageId);
      if (newPosition % 2 === 0) parentPackage.leftChildId = newHybridPackage._id;
      else parentPackage.rightChildId = newHybridPackage._id;
      await parentPackage.save();
    }

    let matrixResult = null;
    if (user.parentId && user.parentId !== "SYSTEM") {
      const sponsorHybridPkg = await TestHybridPackage.findOne({ userId: user.parentId });
      if (sponsorHybridPkg) {
        if (!sponsorHybridPkg.matrixLeft) {
          sponsorHybridPkg.matrixLeft = userId;
          await sponsorHybridPkg.save();
          matrixResult = `Set as ${user.parentId}'s matrixLeft`;
        } else if (!sponsorHybridPkg.matrixRight) {
          sponsorHybridPkg.matrixRight = userId;
          await sponsorHybridPkg.save();
          matrixResult = `Set as ${user.parentId}'s matrixRight — triggering matrix entry`;
          await testEnterMatrix(user.parentId);
        } else {
          matrixResult = `${user.parentId} already has 2 matrix children`;
        }
      }
    }

    res.status(201).json({
      success: true,
      message: `${userId} joined hybrid at position ${newPosition}`,
      matrixResult,
      data: newHybridPackage.toObject(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getTestState = async (req, res) => {
  try {
    await ensureTestModels();
    const users = await TestUser.find().select("userId name parentId").sort({ createdAt: 1 }).lean();
    const hybridPkgs = await TestHybridPackage.find()
      .select("userId position matrixLeft matrixRight leftChildId rightChildId")
      .sort({ position: 1 }).lean();
    const matrixPkgs = await TestMatrixPackage.find()
      .sort({ hm: 1, part: 1, position: 1 }).lean();

    res.status(200).json({
      success: true,
      data: { users, hybridPackages: hybridPkgs, matrixPackages: matrixPkgs },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.resetTestData = async (req, res) => {
  try {
    await ensureTestModels();

    // Keep the first created user (ROOT)
    const firstUser = await TestUser.findOne().sort({ createdAt: 1 }).lean();

    if (firstUser) {
      await TestUser.deleteMany({ _id: { $ne: firstUser._id } });
    } else {
      await TestUser.deleteMany({});
    }

    await TestHybridPackage.deleteMany({});
    await TestMatrixPackage.deleteMany({});
    res.status(200).json({ success: true, message: `Reset done. Kept ${firstUser?.name || "no"} user.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Matrix stages for a user (test DB)
exports.getTestMatrixStages = async (req, res) => {
  try {
    await ensureTestModels();
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, message: "userId query param required" });

    const userStages = await TestMatrixPackage.aggregate([
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

    const stages = STAGE_CONFIG.map((config) => {
      const userStage = userStages.find((s) => s.hm === config.hm && s.part === config.part);
      return {
        hm: config.hm, part: config.part, entry: config.entry, income: config.income,
        childrenRequired: CHILDREN_REQUIRED[config.part],
        joined: !!userStage, status: userStage?.status || null,
        position: userStage?.position || null,
        children: userStage?.childrenData || [],
        completedAt: userStage?.completedAt || null,
      };
    });

    res.status(200).json({ success: true, data: stages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Matrix stage tree for a user (test DB)
exports.getTestMatrixStageTree = async (req, res) => {
  try {
    await ensureTestModels();
    const { userId, hm: hmStr, part: partStr } = req.query;
    const hm = parseInt(hmStr);
    const part = parseInt(partStr);

    if (!userId || !hm || !part) {
      return res.status(400).json({ success: false, message: "userId, hm, part required" });
    }

    const userPkg = await TestMatrixPackage.findOne({ userId, hm, part });
    if (!userPkg) {
      return res.status(200).json({ success: true, data: null });
    }

    // Debug: log all matrix packages in this stage
    const allMatrixInStage = await TestMatrixPackage.find({ hm, part }).lean();
    console.log(`[MATRIX-TREE] HM${hm}-P${part} packages:`, JSON.stringify(allMatrixInStage.map(p => ({ userId: p.userId, pos: p.position, children: p.children })), null, 2));

    const allInStage = await TestMatrixPackage.aggregate([
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
          userId: 1, position: 1, children: 1, status: 1,
          parentPackageId: 1, createdAt: 1,
          name: "$user.name", parentId: "$user.parentId",
        },
      },
    ]);

    const pkgMap = {};
    allInStage.forEach((p) => { pkgMap[p._id.toString()] = p; });

    const required = CHILDREN_REQUIRED[part];
    const buildNode = (pkgId) => {
      if (!pkgId) return null;
      const p = pkgMap[pkgId.toString()];
      if (!p) return null;
      const childNodes = [];
      for (let i = 0; i < required; i++) {
        childNodes.push(p.children[i] ? buildNode(p.children[i]) : null);
      }
      return {
        userId: p.userId, name: p.name || null, parentId: p.parentId || null,
        position: p.position, status: p.status, isCurrentUser: p.userId === userId,
        createdAt: p.createdAt, children: childNodes,
      };
    };

    res.status(200).json({ success: true, data: buildNode(userPkg._id) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Matrix team graph from hybrid (test DB)
exports.getTestMatrixTreeFromHybrid = async (req, res) => {
  try {
    await ensureTestModels();
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ success: false, message: "userId required" });

    const packages = await TestHybridPackage.aggregate([
      { $match: { matrixLeft: { $exists: true } } },
      { $project: { userId: 1, matrixLeft: 1, matrixRight: 1, createdAt: 1 } },
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
          userId: 1, matrixLeft: 1, matrixRight: 1, createdAt: 1,
          name: "$user.name", parentId: "$user.parentId",
        },
      },
    ]);

    const map = {};
    packages.forEach((p) => { map[p.userId] = p; });

    const buildNode = (uid) => {
      if (!uid) return null;
      const p = map[uid];
      if (!p) return null;
      return {
        userId: uid, name: p.name || null, parentId: p.parentId || null,
        isCurrentUser: uid === userId, createdAt: p.createdAt,
        leftChild: buildNode(p.matrixLeft), rightChild: buildNode(p.matrixRight),
      };
    };

    res.status(200).json({ success: true, data: buildNode(userId) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.loginTestUser = async (req, res) => {
  try {
    await ensureTestModels();
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: "userId is required" });
    }
    const user = await TestUser.findOne({ userId });
    if (!user) {
      return res.status(400).json({ success: false, message: `User ${userId} not found` });
    }
    const token = jwt.sign(
      { userId: user.userId, walletAddress: user.walletAddress },
      process.env.JWT_SECRET || "test-secret-key",
      { expiresIn: "24h" }
    );
    res.status(200).json({
      success: true,
      message: `Logged in as ${user.name} (${userId})`,
      token,
      user: { userId: user.userId, name: user.name, parentId: user.parentId },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
