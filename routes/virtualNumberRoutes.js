const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { pinMiddleware } = require('../middleware/pinMiddleware');
// const { verifiedMiddleware } = require('../middleware/verifiedMiddleware');
const {
    listCountries,
    listProducts,
    buyNumber,
    checkSms,
    cancelNumberOrder,
    finishNumberOrder,
    getMyOrders,
    getOrderById
} = require('../controllers/virtualNumberController');

// Public — no auth needed to browse
router.get('/countries', listCountries);
router.get('/products/:country', listProducts);
router.get('/products/:country/:operator', listProducts);

// Protected
router.use(protect);
router.get('/orders', getMyOrders);
router.get('/orders/:id', getOrderById);
router.get('/check/:orderId', checkSms);
router.post('/cancel/:orderId', cancelNumberOrder);
router.post('/finish/:orderId', finishNumberOrder);

// Buy — requires verified email + PIN
router.post('/buy', pinMiddleware, buyNumber);

module.exports = router;
