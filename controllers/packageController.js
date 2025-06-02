const Package = require('../models/Packages');

exports.createPackage = async (req, res) => {
  try {
     const userId = req.user.userId; // Get userId from the request
    const { packageAmount } = req.body;

    if (!userId || !packageAmount) {
      return res.status(400).json({ message: "User ID and package amount are required" });
    }

    // Create a new package
    const newPackage = new Package({
      userId,
      name: packageAmount >= 1000 ? "Gold" : "Silver", // Determine package type based on amount
      packageAmount,
      daily_roi: 0,
      monthly_roi: 0,
      duration: 500 ,
      startDate: new Date(),
      endDate: new Date(Date.now() + 500 * 24 * 60 * 60 * 1000), // Set end date based on duration
      status: "Active"
    });

    // Save the new package to the database
    await newPackage.save();

    // Respond with success
    res.status(201).json({
      message: "Package created successfully and bonus distributed",
      data: newPackage
    });

  } catch (err) {
    console.error("Error creating package:", err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
};

exports.getPackagesByUserId = async (req, res) => {
  try {

    const userId = req.user.userId;

    // Validate userId
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required"
      });
    }

    // Find all packages for the user
    const packages = await Package.find({ userId })
      .sort({ startDate: -1 }) // Sort by newest first
      .select('packageAmount startDate status createdAt');



    res.status(200).json({
      success: true,
      message: "Packages retrieved successfully",
      data: packages
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