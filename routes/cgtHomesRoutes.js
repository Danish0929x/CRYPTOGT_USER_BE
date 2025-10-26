const express = require('express');
const router = express.Router();
const accountConnectionController = require('../controllers/cgtHomesController');
const transferController = require('../controllers/cgtHomesTransferController');
const authMiddleware = require('../middlewares/authMiddleware');

// Apply auth middleware to all routes
router.use(authMiddleware);

// Connect CGTHomes account
router.post('/connect', authMiddleware, accountConnectionController.connectCGTHomesAccount);

// Disconnect CGTHomes account
router.post('/disconnect', authMiddleware, accountConnectionController.disconnectCGTHomesAccount);

// Get connection status
router.get('/status', authMiddleware, accountConnectionController.getConnectionStatus);

// Transfer USDT to CGT Homes
router.post('/transfer', authMiddleware, transferController.withdrawUSDTToCGTHomes);

module.exports = router;