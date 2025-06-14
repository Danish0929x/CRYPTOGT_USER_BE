const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');

// Protected routes (require authentication)
router.get('/getuser', authMiddleware, userController.getUser);
router.put('/update-user', authMiddleware, userController.updateUser);
router.get('/get-wallet', authMiddleware, userController.getWallet);
router.get('/get-dashboard', authMiddleware, userController.getDashboard);

module.exports = router;