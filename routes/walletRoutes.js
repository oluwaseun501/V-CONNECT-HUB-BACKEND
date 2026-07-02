const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { pinMiddleware } = require('../middleware/pinMiddleware');
// const { verifiedMiddleware } = require('../middleware/verifiedMiddleware');
const { transferFunds, initiateFunding, verifyFunding, paystackWebhook, getTransactionHistory, initiateKorapayFunding, verifyKorapayFunding, korapayWebhook } = require('../controllers/walletController');


router.post('/webhook/paystack', paystackWebhook);
router.post('/webhook/korapay', korapayWebhook);

// Protected
router.use(protect);
router.get('/verify/:reference', verifyFunding);
router.get('/transactions', getTransactionHistory);
router.post('/fund/korapay', initiateKorapayFunding);
router.get('/verify/korapay/:reference', verifyKorapayFunding);

// Fund wallet — requires verified email
router.post('/fund', initiateFunding);

// Transfer — requires verified email + PIN
router.post('/transfer', pinMiddleware, transferFunds);

module.exports = router;
