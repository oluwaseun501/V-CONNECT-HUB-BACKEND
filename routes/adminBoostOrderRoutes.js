const express = require("express");
const router = express.Router();

const { protect, admin } = require("../middleware/authMiddleware");

const {
  getAdminBoostOrders,
  refreshAdminBoostOrder,
  cancelAdminBoostOrder,
} = require("../controllers/adminBoostOrderController");

router.use(protect, admin);

router.get("/", getAdminBoostOrders);
router.post("/:id/refresh", refreshAdminBoostOrder);
router.post("/:id/cancel", cancelAdminBoostOrder);

module.exports = router;