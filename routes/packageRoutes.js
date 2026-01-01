const express = require('express');
const router = express.Router();
const packageController = require('../controllers/packageController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/create-package', authMiddleware, packageController.createPackage);
router.post('/re-topup', authMiddleware, packageController.reTopUp);
router.post('/create-hybrid-package', authMiddleware, packageController.createHybridPackage);
router.get('/getPackagesByUserId', authMiddleware, packageController.getPackagesByUserId);
router.get('/get-hybrid-packages', authMiddleware, packageController.getHybridPackageByUserId);
router.get('/get-direct-hybrid-packages', authMiddleware, packageController.getDirectHybridPackages);

module.exports = router;