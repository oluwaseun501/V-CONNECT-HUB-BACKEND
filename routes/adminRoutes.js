const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getDashboardStats,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
    fundUserWallet,
    debitUserWallet,
    getAllTransactions,
    getAllOrders
} = require('../controllers/adminController');

router.use(protect, admin);

router.get('/stats', getDashboardStats);
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/fund', fundUserWallet);
router.post('/users/:id/debit', debitUserWallet);
router.get('/transactions', getAllTransactions);
router.get('/orders', getAllOrders);

module.exports = router;
