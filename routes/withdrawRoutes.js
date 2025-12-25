const express = require("express");
const router = express.Router();
const withdrawController  = require("../controllers/withdrawController");
const authMiddleware = require('../middlewares/authMiddleware');

router.post("/withdraw-request", authMiddleware, withdrawController.withdrawUSDT);
router.post("/withdraw-hybrid", authMiddleware, withdrawController.withdrawHybrid);
router.get("/hybrid-withdrawal-history", authMiddleware, withdrawController.getHybridWithdrawalHistory);

module.exports = router;
