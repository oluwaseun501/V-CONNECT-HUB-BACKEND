const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getPublicServices, placeOrder, getOrderStatus, getMyOrders } = require('../controllers/boostingController');

router.get('/services', getPublicServices);           // public
router.post('/order', protect, placeOrder);           // auth required
router.get('/order/:id', protect, getOrderStatus);    // auth required
router.get('/orders', protect, getMyOrders);          // auth required

module.exports = router;