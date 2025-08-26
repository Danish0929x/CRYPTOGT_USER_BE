// routes/autopoolRoutes.js
const express = require('express');
const router = express.Router();
const autopoolController = require('../controllers/autopoolController');
const authMiddleware = require('../middlewares/authMiddleware'); // Your auth middleware

// Apply auth middleware to all routes
router.use(authMiddleware);

// Join autopool
router.post('/join', autopoolController.joinAutopool);

// Get autopool history
router.get('/history', autopoolController.getAutopoolHistory);

// Get autopool tree
router.get('/tree', autopoolController.getAutopoolTree);

// Get autopool statistics
router.get('/stats', autopoolController.getAutopoolStats);

module.exports = router;