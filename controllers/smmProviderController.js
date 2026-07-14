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

        const response = await axios.post(provider.apiUrl, {
            key: provider.apiKey,
            action: 'services'
        });

        const services = response.data;
        if (!Array.isArray(services)) return res.status(400).json({ message: 'Unexpected response from provider' });

        let added = 0, updated = 0;

        for (const s of services) {
            const markup = provider.markupPercent || 0;
            const providerPrice = parseFloat(s.rate); // price per 1000 from provider
            const markedUpPrice = parseFloat((providerPrice * (1 + markup / 100)).toFixed(4));

            const existing = await SMMService.findOne({ provider: provider._id, serviceId: s.service });
            if (existing) {
                existing.name = s.name;
                existing.category = s.category;
                existing.providerPrice = providerPrice;
                existing.minOrder = s.min;
                existing.maxOrder = s.max;
                // Don't overwrite customPrice if admin already set one
                if (!existing.customPrice) existing.customPrice = markedUpPrice;
                await existing.save();
                updated++;
            } else {
                await SMMService.create({
                    provider: provider._id,
                    serviceId: s.service,
                    name: s.name,
                    category: s.category,
                    providerPrice,
                    customPrice: markedUpPrice,
                    minOrder: s.min,
                    maxOrder: s.max
                });
                added++;
            }
        }

        res.status(200).json({ message: `Sync complete — ${added} added, ${updated} updated` });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET all services (with provider price + your price)
const getSMMServices = async (req, res) => {
    try {
        const services = await SMMService.find().populate('provider', 'name').sort({ category: 1 });
        res.status(200).json(services);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PATCH update custom price or enable/disable a service
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

module.exports = {
    getAllSMMProviders, addSMMProvider, updateSMMProvider,
    setActiveSMMProvider, deleteSMMProvider,
    syncSMMServices, getSMMServices, updateSMMService
};