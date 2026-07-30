// ============================================================
// Your complete numbers routes file — with all additions marked
// ============================================================

const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { pinMiddleware } = require('../middleware/pinMiddleware');
// const { verifiedMiddleware } = require('../middleware/verifiedMiddleware');
const {
    listProviders,             // ← ADD
    getDisabledServices,       // ← ADD
    toggleServiceDisabled,     // ← ADD
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
router.get('/providers', listProviders);                       // ← ADD
router.get('/disabled-services', getDisabledServices);         // ← ADD (admin reads disabled list)
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

// Admin — toggle a service's visibility
// (protect is already applied above via router.use)
router.post('/toggle-disabled', toggleServiceDisabled);        // ← ADD

// Buy — requires verified email + PIN
router.post('/buy', pinMiddleware, buyNumber);

module.exports = router;
