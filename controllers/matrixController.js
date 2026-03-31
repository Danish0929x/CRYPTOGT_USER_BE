const MatrixPackage = require("../models/MatrixPackage");
const HybridPackage = require("../models/HybridPackage");
const User = require("../models/User");

// Auto-enter a user into the matrix tree
// Called when a sponsor reaches 4 direct hybrid packages
const enterMatrix = async (userId) => {
  try {
    console.log("=== MATRIX AUTO-ENTRY START ===");
    console.log("User ID:", userId);

    // Check if user already has a matrix entry
    const existingMatrix = await MatrixPackage.findOne({ userId });
    if (existingMatrix) {
      console.log("User already in matrix, skipping");
      return { success: false, message: "User already in matrix" };
    }

    // Verify user actually has 4+ direct hybrid referrals
    const directUsers = await User.find({ parentId: userId }).select("userId");
    const directUserIds = directUsers.map((u) => u.userId);
    const directHybridCount = await HybridPackage.countDocuments({
      userId: { $in: directUserIds },
    });

    if (directHybridCount < 4) {
      console.log(
        `User has ${directHybridCount} direct hybrid referrals, need 4`
      );
      return {
        success: false,
        message: `Need 4 direct hybrid referrals, have ${directHybridCount}`,
      };
    }

    // Find placement position in the matrix tree (sequential, left-to-right)
    let newPosition = null;
    let parentPackageId = null;

    const allPackages = await MatrixPackage.find().select("position");
    const existingPositions = new Set(allPackages.map((p) => p.position));
    const highestPosition =
      allPackages.length > 0 ? Math.max(...allPackages.map((p) => p.position)) : 0;

    // Start from position 1 (root) or 2 if root exists
    const startPosition = existingPositions.has(1) ? 2 : 1;

    for (let pos = startPosition; pos <= highestPosition + 1; pos++) {
      if (!existingPositions.has(pos)) {
        const parentPos = Math.floor(pos / 2);

        if (parentPos === 0) {
          // Root position
          newPosition = pos;
          parentPackageId = null;
          console.log(`Found empty root position: ${pos}`);
          break;
        } else if (existingPositions.has(parentPos)) {
          const parentPackage = await MatrixPackage.findOne({
            position: parentPos,
          }).select("position leftChildId rightChildId");

          if (parentPackage) {
            const isLeftChild = pos % 2 === 0;
            const slotIsEmpty = isLeftChild
              ? !parentPackage.leftChildId
              : !parentPackage.rightChildId;

            if (slotIsEmpty) {
              newPosition = pos;
              parentPackageId = parentPackage._id;
              console.log(
                `Found empty position ${pos} (${isLeftChild ? "LEFT" : "RIGHT"} child of position ${parentPos})`
              );
              break;
            }
          }
        }
      }
    }

    if (!newPosition) {
      // Fallback
      newPosition = highestPosition + 1;
      const parentPos = Math.floor(newPosition / 2);
      const parentPkg = await MatrixPackage.findOne({ position: parentPos });
      parentPackageId = parentPkg?._id || null;
      console.log(`Fallback to position: ${newPosition}`);
    }

    // Create matrix entry
    const newMatrixPackage = new MatrixPackage({
      userId,
      position: newPosition,
      parentPackageId,
      status: "Active",
    });

    await newMatrixPackage.save();
    console.log("Matrix entry saved with ID:", newMatrixPackage._id);

    // Update parent's child reference
    if (parentPackageId) {
      const parentPackage = await MatrixPackage.findById(parentPackageId);
      if (newPosition % 2 === 0) {
        parentPackage.leftChildId = newMatrixPackage._id;
        console.log(`Updated parent's LEFT child`);
      } else {
        parentPackage.rightChildId = newMatrixPackage._id;
        console.log(`Updated parent's RIGHT child`);
      }
      await parentPackage.save();
    }

    console.log("=== MATRIX AUTO-ENTRY SUCCESS ===");
    return {
      success: true,
      message: "User entered matrix successfully",
      data: newMatrixPackage,
    };
  } catch (error) {
    console.error("Error entering matrix:", error);
    return { success: false, message: error.message };
  }
};

// Get user's matrix package details
const getMatrixPackage = async (req, res) => {
  try {
    const userId = req.user.userId;

    const matrixPackage = await MatrixPackage.findOne({ userId });

    if (!matrixPackage) {
      return res.status(200).json({
        success: true,
        message: "User not in matrix yet. Need 4 direct hybrid referrals to enter.",
        data: null,
      });
    }

    // Count direct hybrid referrals for context
    const directUsers = await User.find({ parentId: userId }).select("userId");
    const directUserIds = directUsers.map((u) => u.userId);
    const directHybridCount = await HybridPackage.countDocuments({
      userId: { $in: directUserIds },
    });

    res.status(200).json({
      success: true,
      message: "Matrix package retrieved successfully",
      directHybridCount,
      data: matrixPackage,
    });
  } catch (error) {
    console.error("Error fetching matrix package:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch matrix package",
      error: error.message,
    });
  }
};

// Get matrix tree starting from user's position
const getMatrixTree = async (req, res) => {
  try {
    const userId = req.user.userId;

    const userPackage = await MatrixPackage.findOne({ userId }).select(
      "_id userId position parentPackageId leftChildId rightChildId createdAt"
    );

    if (!userPackage) {
      return res.status(200).json({
        success: true,
        message: "No matrix package found",
        data: null,
      });
    }

    // Fetch all matrix packages and users for building tree
    const allPackages = await MatrixPackage.find({})
      .select(
        "_id userId position parentPackageId leftChildId rightChildId createdAt"
      )
      .lean();

    const allUsers = await User.find({}).select("userId parentId name").lean();
    const userMap = {};
    allUsers.forEach((user) => {
      userMap[user.userId] = { parentId: user.parentId, name: user.name };
    });

    const packageMap = {};
    allPackages.forEach((pkg) => {
      packageMap[pkg._id] = pkg;
    });

    const buildTree = (packageId, currentUserId) => {
      if (!packageId) return null;
      const pkg = packageMap[packageId];
      if (!pkg) return null;

      return {
        id: pkg._id.toString(),
        userId: pkg.userId,
        name: userMap[pkg.userId]?.name || null,
        parentId: userMap[pkg.userId]?.parentId || null,
        position: pkg.position,
        isCurrentUser: pkg.userId === currentUserId,
        createdAt: pkg.createdAt,
        leftChild: buildTree(pkg.leftChildId, currentUserId),
        rightChild: buildTree(pkg.rightChildId, currentUserId),
      };
    };

    const tree = buildTree(userPackage._id, userId);

    res.status(200).json({
      success: true,
      message: "Matrix tree retrieved successfully",
      data: tree,
    });
  } catch (error) {
    console.error("Error fetching matrix tree:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch matrix tree",
      error: error.message,
    });
  }
};

// Get matrix stats (total members, user's position info)
const getMatrixStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    const totalMembers = await MatrixPackage.countDocuments({ status: "Active" });
    const userPackage = await MatrixPackage.findOne({ userId });

    // Count members below user in matrix tree
    let membersBelow = 0;
    if (userPackage) {
      const countBelow = async (pkgId) => {
        if (!pkgId) return 0;
        const pkg = await MatrixPackage.findById(pkgId).select(
          "leftChildId rightChildId"
        );
        if (!pkg) return 0;
        let count = 0;
        if (pkg.leftChildId) count += 1 + (await countBelow(pkg.leftChildId));
        if (pkg.rightChildId) count += 1 + (await countBelow(pkg.rightChildId));
        return count;
      };
      membersBelow = await countBelow(userPackage._id);
    }

    res.status(200).json({
      success: true,
      data: {
        totalMembers,
        userInMatrix: !!userPackage,
        userPosition: userPackage?.position || null,
        membersBelow,
      },
    });
  } catch (error) {
    console.error("Error fetching matrix stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch matrix stats",
      error: error.message,
    });
  }
};

module.exports = {
  enterMatrix,
  getMatrixPackage,
  getMatrixTree,
  getMatrixStats,
};
