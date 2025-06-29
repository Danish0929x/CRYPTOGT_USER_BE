const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const authMiddleware = require('../middlewares/authMiddleware'); // Assuming you have auth middleware

// GET referral details by referral ID
router.get('/getreferraldetails/:id', referralController.getReferralDetails);

// GET user's referral network (requires authentication)
router.post('/getreferralnetwork', authMiddleware, referralController.getReferralNetwork);

// GET referral statistics (requires authentication)
router.get('/getreferralstats', authMiddleware, referralController.getReferralStats);

// GET getRank And Reward (requires authentication)
router.get('/get-rank-reward', authMiddleware, referralController.getRankAndReward);

module.exports = router;