const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/authMiddleware');
const {
    getAllSMMProviders, addSMMProvider, updateSMMProvider,
    setActiveSMMProvider, deleteSMMProvider,
    syncSMMServices, getSMMServices, updateSMMService, getSMMCategories
} = require('../controllers/smmProviderController');

router.use(protect, admin);

// Provider management
router.get('/', getAllSMMProviders);
router.post('/', addSMMProvider);
router.put('/:id', updateSMMProvider);
router.patch('/:id/activate', setActiveSMMProvider);
router.delete('/:id', deleteSMMProvider);

// Services
router.post('/services/sync', syncSMMServices);
router.get('/services', getSMMServices);
router.patch('/services/:id', updateSMMService);
router.get('/services/categories', getSMMCategories);


module.exports = router;