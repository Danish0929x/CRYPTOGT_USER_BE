const express = require("express");
const router = express.Router();
const matrixController = require("../controllers/matrixController");
const authMiddleware = require("../middlewares/authMiddleware");

router.get("/get-matrix-package", authMiddleware, matrixController.getMatrixPackage);
router.get("/get-matrix-tree", authMiddleware, matrixController.getMatrixTree);
router.get("/get-matrix-stats", authMiddleware, matrixController.getMatrixStats);

module.exports = router;
