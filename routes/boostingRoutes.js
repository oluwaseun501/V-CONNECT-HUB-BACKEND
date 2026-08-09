const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getPublicServices,
    placeOrder,
    getMyOrders,
    getOrderStatus,
    cancelMyOrder,
} = require('../controllers/boostingController');

router.use(protect);

router.get('/services', getPublicServices);
router.get('/orders', getMyOrders);
router.post('/order', placeOrder);
router.get('/orders/:id', getOrderStatus);
router.post('/orders/:id/cancel', cancelMyOrder);

module.exports = router;