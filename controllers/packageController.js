const Package = require("../models/Packages");
const HybridPackage = require("../models/HybridPackage");
const { distributeDirectBonus } = require("../functions/directDistributeBonus");
const getLiveRate = require("../utils/liveRateUtils");
const Wallet = require("../models/Wallet");
const { performWalletTransaction } = require("../utils/performWalletTransaction");
const { handleDirectMembers } = require("../functions/checkProductVoucher");
const User = require("../models/User");


exports.createPackage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageAmount, txnId } = req.body;
    const liveRate = await getLiveRate();

    const user = await User.findOne({ userId: userId });
    if(!user){
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    if (!userId || !packageAmount) {
      return res.status(400).json({
        success: false,
        message: "User ID and package amount are required",
      });
    }

    // Determine package type and ROI based on amount
    const packageType = packageAmount <= 1000 ? "Leader" : "Investor";

    // Create new package according to model
    const newPackage = new Package({
      userId,
      packageType,
      cgtCoin: parseFloat((packageAmount / liveRate).toFixed(5)),
      packageAmount,
      txnId,
      poi: 0,
      startDate: new Date(),
      status: "Requested", // Using boolean true instead of string
      type: "Buy" 
    });

    await newPackage.save();

    //productVoucher
    await handleDirectMembers(userId, user.parentId, newPackage._id); // Make sure sponsorId is available in req.user


    // Distribute direct bonus to parent

    // Check if user already had packages before this one
    const existingPackagesCount = await Package.countDocuments({
      userId,
      _id: { $ne: newPackage._id }, // exclude the newly created one
    });

    if (existingPackagesCount > 0) {
      // User already has package → call distributeDirectBonus
      await distributeDirectBonus(newPackage.packageAmount, userId);
    } else {
      // User has no previous package → call distributeUSTDirectBonus
      // await distributeUSTDirectBonus(newPackage.packageAmount, userId);
    }


    res.status(201).json({
      success: true,
      message: "Package created successfully",
      data: newPackage,
    });
  } catch (err) {
    console.error("Error creating package:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

exports.reTopUp = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageAmount } = req.body;
    const liveRate = await getLiveRate();

    if (!userId || !packageAmount) {
      return res.status(400).json({
        success: false,
        message: "User ID and package amount are required",
      });
    }

    const userWallet = await Wallet.findOne({ userId });
    if (!userWallet) {
      return res.status(400).json({
        success: false,
        message: "Wallet not found",
      });
    }

    if (userWallet.USDTBalance < packageAmount) {
      return res.status(400).json({
        success: false,
        message: "Insufficient USDT balance",
        availableBalance: userWallet.USDTBalance,
        requiredAmount: packageAmount,
      });
    }

    await performWalletTransaction(
      userId,
      -packageAmount, // Negative for debit
      "USDTBalance",
      "Retop up",
      "Completed"
    );
    // Determine package type and ROI based on amount
    const packageType = packageAmount <= 1000 ? "Leader" : "Investor";

    // Create new package according to model
    const newPackage = new Package({
      userId,
      packageType,
      cgtCoin: parseFloat((packageAmount / liveRate).toFixed(5)),
      packageAmount,
      txnId: null,
      poi: 0,
      startDate: new Date(),
      status: "Active", // Using boolean true instead of string
      type: "ReTopup"  
    });

    await newPackage.save();

    // Distribute direct bonus to parent
    await distributeDirectBonus(newPackage.packageAmount, userId);

    res.status(201).json({
      success: true,
      message: "Retop up successfully",
      data: newPackage,
    });
  } catch (err) {
    console.error("Error creating package:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

exports.createHybridPackage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { txnId } = req.body;

    // Validate user exists
    const user = await User.findOne({ userId: userId });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User not found",
      });
    }

    // Calculate next position in binary tree
    const totalPackages = await HybridPackage.countDocuments();
    const newPosition = totalPackages + 1;

    // Calculate parent position (binary tree logic)
    let parentPackageId = null;
    if (newPosition > 1) {
      const parentPosition = Math.floor(newPosition / 2);
      const parentPackage = await HybridPackage.findOne({ position: parentPosition });

      if (parentPackage) {
        parentPackageId = parentPackage._id;
      }
    }

    // Create new hybrid package with fixed amount of 10 USDT using HybridPackage model
    const newHybridPackage = new HybridPackage({
      userId,
      position: newPosition,
      parentPackageId,
      txnId: txnId || null,
      status: "Active",
    });

    await newHybridPackage.save();

    // Update parent's left or right child reference
    if (parentPackageId) {
      const parentPackage = await HybridPackage.findById(parentPackageId);

      if (newPosition % 2 === 0) {
        // Even position = left child
        parentPackage.leftChildId = newHybridPackage._id;
      } else {
        // Odd position = right child
        parentPackage.rightChildId = newHybridPackage._id;
      }

      await parentPackage.save();
    }

    res.status(201).json({
      success: true,
      message: "Hybrid package created successfully",
      data: newHybridPackage,
    });
  } catch (err) {
    console.error("Error creating hybrid package:", err);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: err.message,
    });
  }
};

exports.getPackagesByUserId = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    const packages = await Package.find({ userId })
      .sort({ startDate: -1 })
      .select("packageType packageAmount roi startDate status createdAt");

    const totalAmount = packages.reduce(
      (sum, pkg) => sum + pkg.packageAmount,
      0
    );

    res.status(200).json({
      success: true,
      message: "Packages retrieved successfully",
      totalInvestment: totalAmount,
      data: packages.map((pkg) => ({
        id: pkg._id,
        type: pkg.packageType,
        amount: pkg.packageAmount,
        roi: pkg.roi,
        startDate: pkg.startDate,
        status: pkg.status ? "Active" : "Inactive",
        createdAt: pkg.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch packages",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getHybridPackageByUserId = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Fetch all Hybrid packages for the user using HybridPackage model
    const hybridPackages = await HybridPackage.find({
      userId,
    })
      .sort({ createdAt: -1 })
      .select("packageType packageAmount startDate endDate status type createdAt");

    // Calculate total investment in Hybrid packages
    const totalHybridInvestment = hybridPackages.reduce(
      (sum, pkg) => sum + pkg.packageAmount,
      0
    );

    res.status(200).json({
      success: true,
      message: "Hybrid packages retrieved successfully",
      count: hybridPackages.length,
      totalInvestment: totalHybridInvestment,
      data: hybridPackages.map((pkg) => ({
        id: pkg._id,
        type: pkg.packageType,
        amount: pkg.packageAmount,
        startDate: pkg.startDate,
        endDate: pkg.endDate,
        status: pkg.status,
        purchaseType: pkg.type,
        createdAt: pkg.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching Hybrid packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Hybrid packages",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getDirectHybridPackages = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Get all users whose parentId is the current user
    const directUsers = await User.find({ parentId: userId }).select("userId");
    const directUserIds = directUsers.map((user) => user.userId);

    // If no direct users, return empty array
    if (directUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No direct hybrid packages found",
        count: 0,
        totalInvestment: 0,
        data: [],
      });
    }

    // Fetch all Hybrid packages for direct users using HybridPackage model
    const directHybridPackages = await HybridPackage.find({
      userId: { $in: directUserIds },
    })
      .sort({ createdAt: -1 })
      .select("userId packageType packageAmount startDate endDate status type createdAt");

    // Get user details for display
    const userDetails = await User.find({ userId: { $in: directUserIds } }).select("userId name");
    const userMap = {};
    userDetails.forEach((user) => {
      userMap[user.userId] = user.name;
    });

    // Calculate total investment in Direct Hybrid packages
    const totalDirectHybridInvestment = directHybridPackages.reduce(
      (sum, pkg) => sum + pkg.packageAmount,
      0
    );

    res.status(200).json({
      success: true,
      message: "Direct hybrid packages retrieved successfully",
      count: directHybridPackages.length,
      totalInvestment: totalDirectHybridInvestment,
      data: directHybridPackages.map((pkg) => ({
        id: pkg._id,
        userId: pkg.userId,
        userName: userMap[pkg.userId] || "Unknown",
        type: pkg.packageType,
        amount: pkg.packageAmount,
        startDate: pkg.startDate,
        endDate: pkg.endDate,
        status: pkg.status,
        purchaseType: pkg.type,
        createdAt: pkg.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error fetching Direct Hybrid packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Direct Hybrid packages",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

exports.getHybridAutopoolTree = async (req, res) => {
  try {
    // Find the root package (position 1) - the starting point of the entire autopool tree
    const rootPackage = await HybridPackage.findOne({
      position: 1,
    }).select("userId position parentPackageId leftChildId rightChildId createdAt");

    if (!rootPackage) {
      return res.status(404).json({
        success: false,
        message: "No hybrid autopool tree found",
        data: null,
      });
    }

    // Recursive function to build the tree with user details
    const buildTree = async (packageId) => {
      if (!packageId) return null;

      const pkg = await HybridPackage.findById(packageId)
        .select("userId position parentPackageId leftChildId rightChildId createdAt")
        .lean();

      if (!pkg) return null;

      // Get user details
      const user = await User.findOne({ userId: pkg.userId }).select("userId name email").lean();

      return {
        id: pkg._id,
        userId: pkg.userId,
        userName: user?.name || "Unknown",
        userEmail: user?.email || "N/A",
        position: pkg.position,
        createdAt: pkg.createdAt,
        leftChild: await buildTree(pkg.leftChildId),
        rightChild: await buildTree(pkg.rightChildId),
      };
    };

    const tree = await buildTree(rootPackage._id);

    res.status(200).json({
      success: true,
      message: "Hybrid autopool tree retrieved successfully",
      data: tree,
    });
  } catch (error) {
    console.error("Error fetching Hybrid Autopool tree:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch Hybrid Autopool tree",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
