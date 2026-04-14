const express = require("express");
const router = express.Router();
const testController = require("../controllers/testController");

// No auth middleware — these are test-only endpoints
router.post("/create-user", testController.createTestUser);
router.post("/join-hybrid", testController.joinTestHybrid);
router.post("/login", testController.loginTestUser);
router.get("/state", testController.getTestState);
router.get("/matrix-stages", testController.getTestMatrixStages);
router.get("/matrix-stage-tree", testController.getTestMatrixStageTree);
router.get("/matrix-tree-hybrid", testController.getTestMatrixTreeFromHybrid);
router.delete("/reset", testController.resetTestData);

module.exports = router;
