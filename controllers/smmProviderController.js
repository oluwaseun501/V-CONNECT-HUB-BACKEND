const SMMProvider = require('../models/SMMProvider');
const SMMService = require('../models/SMMService');
const axios = require('axios');

// GET all providers
const getAllSMMProviders = async (req, res) => {
    try {
        const providers = await SMMProvider.find().sort({ createdAt: -1 });
        const masked = providers.map(p => ({
            ...p.toObject(),
            apiKey: '••••••' + p.apiKey.slice(-6)
        }));
        res.status(200).json(masked);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST add provider
const addSMMProvider = async (req, res) => {
    try {
        const { name, apiUrl, apiKey, markupPercent, notes } = req.body;
        if (!name || !apiUrl || !apiKey) {
            return res.status(400).json({ message: 'name, apiUrl and apiKey are required' });
        }
        const provider = await SMMProvider.create({ name, apiUrl, apiKey, markupPercent, notes });
        res.status(201).json({
            message: 'SMM Provider added',
            provider: { ...provider.toObject(), apiKey: '••••••' + provider.apiKey.slice(-6) }
        });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: 'Provider with that name already exists' });
        res.status(500).json({ message: error.message });
    }
};

// PUT update provider
const updateSMMProvider = async (req, res) => {
    try {
        const { name, apiUrl, apiKey, markupPercent, notes } = req.body;
        const update = {};
        if (name) update.name = name;
        if (apiUrl) update.apiUrl = apiUrl;
        if (apiKey) update.apiKey = apiKey;
        if (markupPercent !== undefined) update.markupPercent = markupPercent;
        if (notes !== undefined) update.notes = notes;

        const provider = await SMMProvider.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!provider) return res.status(404).json({ message: 'Provider not found' });
        res.status(200).json({
            message: 'Provider updated',
            provider: { ...provider.toObject(), apiKey: '••••••' + provider.apiKey.slice(-6) }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PATCH activate provider
const setActiveSMMProvider = async (req, res) => {
    try {
        await SMMProvider.updateMany({}, { isActive: false });
        const provider = await SMMProvider.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
        if (!provider) return res.status(404).json({ message: 'Provider not found' });
        res.status(200).json({ message: `${provider.name} is now the active SMM provider` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// DELETE provider
const deleteSMMProvider = async (req, res) => {
    try {
        const provider = await SMMProvider.findByIdAndDelete(req.params.id);
        if (!provider) return res.status(404).json({ message: 'Provider not found' });
        await SMMService.deleteMany({ provider: req.params.id }); // clean up services
        res.status(200).json({ message: 'Provider deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST sync services from active provider
const syncSMMServices = async (req, res) => {
    try {
        const provider = await SMMProvider.findOne({ isActive: true });
        if (!provider) return res.status(404).json({ message: 'No active SMM provider found' });

        const response = await axios.post(
            provider.apiUrl,
            new URLSearchParams({ key: provider.apiKey, action: 'services' }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000 // 30s timeout for provider API call
            }
        );

        const services = response.data;
        if (!Array.isArray(services)) {
            return res.status(400).json({ message: 'Unexpected response from provider' });
        }

        const markup = provider.markupPercent || 0;

        const bulkOps = services.map(s => {
            const providerPrice = parseFloat(s.rate);
            const markedUpPrice = parseFloat((providerPrice * (1 + markup / 100)).toFixed(4));

            return {
                updateOne: {
                    filter: { provider: provider._id, serviceId: s.service },
                    update: {
                        $set: {
                            name: s.name,
                            category: s.category,
                            providerPrice,
                            minOrder: s.min,
                            maxOrder: s.max,
                        },
                        $setOnInsert: {
                            // Only set customPrice on NEW services — don't overwrite admin-set prices
                            customPrice: markedUpPrice,
                            isEnabled: true,
                        }
                    },
                    upsert: true
                }
            };
        });

        const result = await SMMService.bulkWrite(bulkOps, { ordered: false });

        res.status(200).json({
            message: `Sync complete — ${result.upsertedCount} added, ${result.modifiedCount} updated`
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const updateSMMService = async (req, res) => {
    try {
        const { customPrice, isEnabled } = req.body;
        const update = {};
        if (customPrice !== undefined) update.customPrice = customPrice;
        if (isEnabled !== undefined) update.isEnabled = isEnabled;
        const service = await SMMService.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!service) return res.status(404).json({ message: 'Service not found' });
        res.status(200).json({ message: 'Service updated', service });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
const getSMMServices = async (req, res) => {
    try {
        const page     = parseInt(req.query.page)  || 1;
        const limit    = parseInt(req.query.limit) || 50;
        const search   = req.query.search   || '';
        const category = req.query.category || '';
        const skip     = (page - 1) * limit;

        // ← NEW: only show services from the currently active provider
        const activeProvider = await SMMProvider.findOne({ isActive: true });

        const filter = {};
        if (activeProvider) filter.provider = activeProvider._id;  // ← NEW
        if (search)   filter.name     = { $regex: search, $options: 'i' };
        if (category) filter.category = { $regex: category, $options: 'i' };

        const [services, total] = await Promise.all([
            SMMService.find(filter)
                .populate('provider', 'name')
                .sort({ category: 1, name: 1 })
                .skip(skip)
                .limit(limit),
            SMMService.countDocuments(filter)
        ]);

        res.status(200).json({
            services,
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
const getSMMCategories = async (req, res) => {
    try {
        // ← NEW: filter by active provider
        const activeProvider = await SMMProvider.findOne({ isActive: true });
        const filter = activeProvider ? { provider: activeProvider._id } : {};
        
        const categories = await SMMService.distinct('category', filter);
        res.status(200).json(categories.sort());
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getAllSMMProviders, addSMMProvider, updateSMMProvider,
    setActiveSMMProvider, deleteSMMProvider,
    syncSMMServices, getSMMServices, getSMMCategories, updateSMMService
};