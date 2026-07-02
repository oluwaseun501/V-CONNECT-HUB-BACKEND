const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getMyTransactions, getWalletBalance } = require('../controllers/authController');

router.use(protect);
router.get('/', getMyTransactions);
router.get('/balance', getWalletBalance);

module.exports = router;
