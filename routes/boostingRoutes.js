// routes/boostingRoutes.js
// ── REPLACE your existing boostingRoutes.js with this ──────────────────────
//
// Register in server.js / app.js:
//   const boostingRoutes = require('./routes/boostingRoutes');
//   app.use('/boost', boostingRoutes);
//
// Endpoints:
//   GET  /boost/services      — list enabled services (prices in NGN)
//   GET  /boost/orders        — current user's order history
//   POST /boost/order         — place order  (x-transaction-pin header required)
//   GET  /boost/orders/:id    — single order status
// ──────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getPublicServices,
  placeOrder,
  getMyOrders,
  getOrderStatus,
} = require('../controllers/boostingController');

// All routes require a logged-in user
router.use(protect);

router.get('/services',   getPublicServices);
router.get('/orders',     getMyOrders);
router.post('/order',     placeOrder);        // PIN is read from x-transaction-pin header inside the controller
router.get('/orders/:id', getOrderStatus);

module.exports = router;
