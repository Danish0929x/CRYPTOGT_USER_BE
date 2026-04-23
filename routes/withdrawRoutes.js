const express = require("express");
const router = express.Router();
const withdrawController  = require("../controllers/withdrawController");
const hybridBonusController = require("../controllers/hybridBonusController");
const authMiddleware = require('../middlewares/authMiddleware');

router.post("/withdraw-request", authMiddleware, withdrawController.withdrawUSDT);
router.post("/send-withdraw-otp", authMiddleware, withdrawController.sendWithdrawOTP);
router.post("/withdraw-hybrid", authMiddleware, withdrawController.withdrawHybrid);
router.post("/withdraw-hybrid-balance", authMiddleware, withdrawController.withdrawHybridBalance);
router.post("/withdraw-hybrid-bonus", authMiddleware, hybridBonusController.withdrawHybridBonus);
router.get("/hybrid-withdrawal-history", authMiddleware, withdrawController.getHybridWithdrawalHistory);

module.exports = router;
