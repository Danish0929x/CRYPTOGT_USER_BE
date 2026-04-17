const express = require("express");
const router = express.Router();
const matrixController = require("../controllers/matrixController");
const authMiddleware = require("../middlewares/authMiddleware");

router.get("/get-matrix-stages", authMiddleware, matrixController.getMatrixStages);
router.get("/get-matrix-stage-tree", authMiddleware, matrixController.getMatrixStageTree);
router.post("/claim-matrix-reward", authMiddleware, matrixController.claimMatrixReward);

module.exports = router;
