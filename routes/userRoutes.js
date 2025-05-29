const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middlewares/authMiddleware');

// Protected routes (require authentication)
router.get('/getuser', authMiddleware, userController.getUser);
router.put('/update-profile', authMiddleware, userController.updateProfile);
router.get('/get-profile', authMiddleware, userController.getProfile);
router.get('/get-wallet', authMiddleware, userController.getWallet);

module.exports = router;