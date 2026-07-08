const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middlewares/authMiddleware');

// Public routes
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/login/email', authController.emailPasswordLogin);
router.post('/set-password', authController.setPassword);
router.post('/change-password', authController.changePassword);
router.post('/verify-reset-email', authController.verifyResetEmail);
router.post('/reset-password', authController.resetPassword);
router.post('/send-reset-otp', authController.sendResetOTP);
router.post('/verify-reset-otp', authController.verifyResetOTP);

// Protected routes (require authentication)
router.post('/logout', authMiddleware, authController.logoutUser);

module.exports = router;    