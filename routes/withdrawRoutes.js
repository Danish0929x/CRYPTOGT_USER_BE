const express = require("express");
const router = express.Router();
const withdrawController  = require("../controllers/withdrawController");
const authMiddleware = require('../middlewares/authMiddleware');

router.post("/withdraw-request", authMiddleware, withdrawController.withdrawUSDT);

module.exports = router;
