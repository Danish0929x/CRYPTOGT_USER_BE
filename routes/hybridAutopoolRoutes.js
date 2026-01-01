// routes/hybridAutopoolRoutes.js
const express = require("express");
const router = express.Router();
const hybridAutopoolController = require("../controllers/hybridAutopoolController");
const authMiddleware = require("../middlewares/authMiddleware");

// All routes require authentication
router.use(authMiddleware);

// Join Hybrid Autopool
router.post("/join", hybridAutopoolController.joinHybridAutopool);

// Get user's hybrid autopool history
router.get("/history", hybridAutopoolController.getHybridAutopoolHistory);

// Get hybrid autopool statistics
router.get("/stats", hybridAutopoolController.getHybridAutopoolStats);

// Get tree view for a specific position
router.get("/tree", hybridAutopoolController.getHybridAutopoolTree);

module.exports = router;
