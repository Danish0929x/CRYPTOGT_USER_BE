const express = require('express');
const authMiddleware = require('../middlewares/authMiddleware');
const router = express.Router();
const transactionController = require('../controllers/transactionController');


// Protected routes (require authentication)
router.post('/get-transaction', authMiddleware, transactionController.getTransactions);

module.exports = router;