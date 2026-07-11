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
    getAllOrders,
    getSettings,       // ← add this
    updateSettings     // ← add this
} = require('../controllers/adminController');

const { getAllProviders, addProvider, updateProvider, setActiveProvider, deleteProvider } = require('../controllers/providerController');


const { getOverrides, upsertOverride, deleteOverride } = require('../controllers/priceOverrideController');

// Public — no admin middleware
router.get('/public/maintenance', async (req, res) => {
    const SiteConfig = require('../models/SiteConfig');
    try {
        const config = await SiteConfig.findOne().lean();
        res.json({ maintenanceMode: config?.maintenanceMode ?? false, maintenanceMessage: config?.maintenanceMessage ?? '' });
    } catch { res.json({ maintenanceMode: false }); }
});

router.use(protect, admin);  // ← everything below requires auth

router.get('/settings', getSettings);
router.put('/settings', updateSettings);

router.get('/stats', getDashboardStats);
router.get('/users', getAllUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/fund', fundUserWallet);
router.post('/users/:id/debit', debitUserWallet);
router.get('/transactions', getAllTransactions);
router.get('/orders', getAllOrders);

router.get('/providers',                 getAllProviders);
router.post('/providers',                addProvider);
router.put('/providers/:id',             updateProvider);
router.patch('/providers/:id/activate',  setActiveProvider);
router.delete('/providers/:id',          deleteProvider);


// Price overrides
router.get('/price-overrides',        protect, admin, getOverrides);
router.post('/price-overrides',       protect, admin, upsertOverride);
router.delete('/price-overrides/:id', protect, admin, deleteOverride);

module.exports = router;