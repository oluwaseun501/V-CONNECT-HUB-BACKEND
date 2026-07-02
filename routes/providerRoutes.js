const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getAllProviders,
    addProvider,
    updateProvider,
    setActiveProvider,
    deleteProvider
} = require('../controllers/providerController');

router.use(protect, admin);

router.get('/', getAllProviders);
router.post('/', addProvider);
router.put('/:id', updateProvider);
router.patch('/:id/activate', setActiveProvider);
router.delete('/:id', deleteProvider);

module.exports = router;
