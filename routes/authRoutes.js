const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// Public routes
router.post('/register', authController.register);
router.post('/verify-otp', authController.verifyOtp);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/get-decrypted-password', authController.getDecryptedPassword);

// Protected routes (require authentication)
router.post('/logout', authMiddleware, authController.logoutUser);

module.exports = router;    