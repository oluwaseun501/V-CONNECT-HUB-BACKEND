const SMMProvider = require('../models/SMMProvider');
const SMMService = require('../models/SMMService');
const axios = require('axios');
const { invalidateServicesCache } = require('../services/smmServicesCache');

function maskApiKey(apiKey) {
    const value = String(apiKey || '');
    return value.length > 6 ? `••••••${value.slice(-6)}` : '••••••';
}

function markedUpPrice(providerPrice, markupPercent) {
    return Number(
        (providerPrice * (1 + Number(markupPercent || 0) / 100)).toFixed(4)
    );
}

async function getAllSMMProviders(req, res) {
    try {
        const providers = await SMMProvider.find().sort({ createdAt: -1 }).lean();
        return res.status(200).json(providers.map((provider) => ({
            ...provider,
            apiKey: maskApiKey(provider.apiKey),
        })));
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function addSMMProvider(req, res) {
    try {
        const { name, apiUrl, apiKey, markupPercent, notes } = req.body;

        if (!name || !apiUrl || !apiKey) {
            return res.status(400).json({
                message: 'name, apiUrl and apiKey are required',
            });
        }

        const provider = await SMMProvider.create({
            name: String(name).trim(),
            apiUrl: String(apiUrl).trim(),
            apiKey,
            markupPercent: Number(markupPercent || 0),
            notes,
        });

        return res.status(201).json({
            message: 'SMM Provider added',
            provider: {
                ...provider.toObject(),
                apiKey: maskApiKey(provider.apiKey),
            },
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({
                message: 'Provider with that name already exists',
            });
        }

        return res.status(500).json({ message: error.message });
    }
}

async function updateSMMProvider(req, res) {
    try {
        const { name, apiUrl, apiKey, markupPercent, notes } = req.body;
        const update = {};

        if (name) update.name = String(name).trim();
        if (apiUrl) update.apiUrl = String(apiUrl).trim();
        if (apiKey) update.apiKey = apiKey;
        if (markupPercent !== undefined) update.markupPercent = Number(markupPercent);
        if (notes !== undefined) update.notes = notes;

        const provider = await SMMProvider.findByIdAndUpdate(
            req.params.id,
            update,
            { new: true, runValidators: true }
        );

        if (!provider) {
            return res.status(404).json({ message: 'Provider not found' });
        }

        return res.status(200).json({
            message: 'Provider updated. Sync services to apply the new markup.',
            provider: {
                ...provider.toObject(),
                apiKey: maskApiKey(provider.apiKey),
            },
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function setActiveSMMProvider(req, res) {
    try {
        const provider = await SMMProvider.findById(req.params.id);

        if (!provider) {
            return res.status(404).json({ message: 'Provider not found' });
        }

        await SMMProvider.updateMany({}, { $set: { isActive: false } });
        provider.isActive = true;
        await provider.save();
        invalidateServicesCache();

        return res.status(200).json({
            message: `${provider.name} is now the active SMM provider`,
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function deleteSMMProvider(req, res) {
    try {
        const provider = await SMMProvider.findByIdAndDelete(req.params.id);

        if (!provider) {
            return res.status(404).json({ message: 'Provider not found' });
        }

        await SMMService.deleteMany({ provider: provider._id });
        invalidateServicesCache();

        return res.status(200).json({ message: 'Provider deleted' });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function syncSMMServices(req, res) {
    try {
        const provider = await SMMProvider.findOne({ isActive: true });

        if (!provider) {
            return res.status(404).json({ message: 'No active SMM provider found' });
        }

        const response = await axios.post(
            provider.apiUrl,
            new URLSearchParams({
                key: provider.apiKey,
                action: 'services',
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000,
                validateStatus: () => true,
            }
        );

        if (response.status >= 500) {
            return res.status(503).json({
                message: 'The boosting provider is temporarily unavailable.',
            });
        }

        if (!Array.isArray(response.data)) {
            return res.status(502).json({
                message: response.data?.error ||
                    'The provider returned an invalid service list.',
            });
        }

        const services = response.data
            .map((service) => ({
                providerServiceId: Number(service.service),
                name: String(service.name || '').trim(),
                category: String(service.category || 'Other').trim(),
                providerPrice: Number(service.rate),
                minOrder: Number(service.min),
                maxOrder: Number(service.max),
                canCancel: service.cancel === true ||
                    service.cancel === 1 ||
                    String(service.cancel).toLowerCase() === 'true' ||
                    String(service.cancel) === '1',
            }))
            .filter((service) =>
                Number.isInteger(service.providerServiceId) &&
                service.name &&
                Number.isFinite(service.providerPrice) &&
                service.providerPrice >= 0 &&
                Number.isInteger(service.minOrder) &&
                Number.isInteger(service.maxOrder)
            );

        const existing = await SMMService.find({
            provider: provider._id,
            serviceId: { $in: services.map((service) => service.providerServiceId) },
        }).select('serviceId customPrice priceSource').lean();

        const existingByServiceId = new Map(
            existing.map((service) => [Number(service.serviceId), service])
        );

        const bulkOps = services.map((service) => {
            const current = existingByServiceId.get(service.providerServiceId);
            const isManual = current?.priceSource === 'manual';
            const automaticPrice = markedUpPrice(
                service.providerPrice,
                provider.markupPercent
            );

            return {
                updateOne: {
                    filter: {
                        provider: provider._id,
                        serviceId: service.providerServiceId,
                    },
                    update: {
                        $set: {
                            name: service.name,
                            category: service.category,
                            providerPrice: service.providerPrice,
                            minOrder: service.minOrder,
                            maxOrder: service.maxOrder,
                            canCancel: service.canCancel,
                            // Manual prices survive future syncs. Services that
                            // have never been manually edited follow markup.
                            customPrice: isManual
                                ? current.customPrice
                                : automaticPrice,
                            priceSource: isManual ? 'manual' : 'markup',
                        },
                        $setOnInsert: {
                            provider: provider._id,
                            serviceId: service.providerServiceId,
                            isEnabled: true,
                        },
                    },
                    upsert: true,
                },
            };
        });

        const result = bulkOps.length
            ? await SMMService.bulkWrite(bulkOps, { ordered: false })
            : { upsertedCount: 0, modifiedCount: 0 };

        invalidateServicesCache();

        return res.status(200).json({
            message: `Sync complete — ${result.upsertedCount || 0} added, ${result.modifiedCount || 0} updated`,
            servicesReceived: response.data.length,
            servicesSynced: services.length,
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function updateSMMService(req, res) {
    try {
        const { customPrice, isEnabled, priceSource } = req.body;
        const update = {};

        if (customPrice !== undefined) {
            const numericPrice = Number(customPrice);
            if (!Number.isFinite(numericPrice) || numericPrice < 0) {
                return res.status(400).json({
                    message: 'customPrice must be a valid non-negative number',
                });
            }

            update.customPrice = numericPrice;
            update.priceSource = priceSource === 'markup' ? 'markup' : 'manual';
        }

        if (priceSource === 'markup') {
            const service = await SMMService.findById(req.params.id).populate('provider');
            if (!service) {
                return res.status(404).json({ message: 'Service not found' });
            }

            update.customPrice = markedUpPrice(
                service.providerPrice,
                service.provider?.markupPercent
            );
            update.priceSource = 'markup';
        }

        if (isEnabled !== undefined) {
            update.isEnabled = Boolean(isEnabled);
        }

        if (!Object.keys(update).length) {
            return res.status(400).json({ message: 'No service changes provided' });
        }

        const service = await SMMService.findByIdAndUpdate(
            req.params.id,
            update,
            { new: true, runValidators: true }
        );

        if (!service) {
            return res.status(404).json({ message: 'Service not found' });
        }

        invalidateServicesCache();
        return res.status(200).json({
            message: 'Service updated',
            service,
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function getSMMServices(req, res) {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
        const search = String(req.query.search || '');
        const category = String(req.query.category || '');
        const activeProvider = await SMMProvider.findOne({ isActive: true }).lean();
        const filter = activeProvider ? { provider: activeProvider._id } : { _id: null };

        if (search) filter.name = { $regex: search, $options: 'i' };
        if (category) filter.category = { $regex: category, $options: 'i' };

        const [services, total] = await Promise.all([
            SMMService.find(filter)
                .populate('provider', 'name markupPercent')
                .sort({ category: 1, name: 1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            SMMService.countDocuments(filter),
        ]);

        return res.status(200).json({
            services,
            total,
            page,
            pages: Math.max(Math.ceil(total / limit), 1),
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function getSMMCategories(req, res) {
    try {
        const activeProvider = await SMMProvider.findOne({ isActive: true }).lean();
        const categories = await SMMService.distinct(
            'category',
            activeProvider ? { provider: activeProvider._id } : { _id: null }
        );

        return res.status(200).json(categories.filter(Boolean).sort());
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

module.exports = {
    getAllSMMProviders,
    addSMMProvider,
    updateSMMProvider,
    setActiveSMMProvider,
    deleteSMMProvider,
    syncSMMServices,
    getSMMServices,
    getSMMCategories,
    updateSMMService,
};