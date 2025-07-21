const Package = require('../models/Packages'); 
const { distributeDirectBonus } = require("../functions/directDistributeBonus");
const getLiveRate = require('../utils/liveRateUtils');


exports.createPackage = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { packageAmount, txnId } = req.body;
    const liveRate = await getLiveRate();

    if (!userId || !packageAmount) {
      return res.status(400).json({ 
        success: false,
        message: "User ID and package amount are required" 
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
      status: true // Using boolean true instead of string
    });

    await newPackage.save();

    // Distribute direct bonus to parent
    await distributeDirectBonus(newPackage.packageAmount , userId);

    res.status(201).json({
      success: true,
      message: "Package created successfully",
      data: newPackage
    });

  } catch (err) {
    console.error("Error creating package:", err);
    res.status(500).json({ 
      success: false,
      message: "Server Error", 
      error: err.message 
    });
  }
};

exports.getPackagesByUserId = async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    const packages = await Package.find({ userId })
      .sort({ startDate: -1 })
      .select('packageType packageAmount roi startDate status createdAt');

    res.status(200).json({
      success: true,
      message: "Packages retrieved successfully",
      data: packages.map(pkg => ({
        id: pkg._id,
        type: pkg.packageType,
        amount: pkg.packageAmount,
        roi: pkg.roi,
        startDate: pkg.startDate,
        status: pkg.status ? "Active" : "Inactive",
        createdAt: pkg.createdAt
      }))
    });

  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch packages",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};