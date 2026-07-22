// controllers/boostingController.js
// Drop-in replacement — adds in-memory cache + parallel DB queries

const SMMService  = require('../models/SMMService');
const SMMProvider = require('../models/SMMProvider');
const BoostOrder  = require('../models/BoostOrder');
const SiteConfig  = require('../models/SiteConfig');
const { debitWallet } = require('../services/walletService');
const axios = require('axios');

// ─── Simple in-memory cache (5 min TTL) ──────────────────────────────────────
let _servicesCache = null;
let _servicesCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function invalidateServicesCache() {
    _servicesCache = null;
    _servicesCacheAt = 0;
}

// ─── Helper: get the current NGN rate ────────────────────────────────────────
const getNgnRate = async () => {
    const siteConfig = await SiteConfig.findOne();
    return siteConfig?.usdToNgn ?? 1600;
};

// GET all enabled services — prices returned in NGN
const getPublicServices = async (req, res) => {
    try {
        // Return cached response if still fresh
        if (_servicesCache && Date.now() - _servicesCacheAt < CACHE_TTL_MS) {
            return res.status(200).json(_servicesCache);
        }

        // Run both DB queries in parallel instead of sequentially
        const [usdToNgn, services] = await Promise.all([
            getNgnRate(),
            SMMService.find({ isEnabled: true })
                .select('serviceId name category customPrice minOrder maxOrder')
                .sort({ category: 1 })
                .lean(), // .lean() returns plain objects — faster than Mongoose documents
        ]);

        const withNgn = services.map(s => ({
            _id:       s._id,
            serviceId: s.serviceId,
            name:      s.name,
            category:  s.category,
            minOrder:  s.minOrder,
            maxOrder:  s.maxOrder,
            ngnPrice:  parseFloat((s.customPrice * usdToNgn).toFixed(2)),
        }));

        // Cache the result
        _servicesCache = withNgn;
        _servicesCacheAt = Date.now();

        res.status(200).json(withNgn);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST place an order — wallet debit is in NGN
const placeOrder = async (req, res) => {
    try {
        const { serviceId, link, quantity } = req.body;

        if (!serviceId || !link || !quantity) {
            return res.status(400).json({ message: 'serviceId, link and quantity are required' });
        }

        const service = await SMMService.findById(serviceId).lean();
        if (!service || !service.isEnabled) {
            return res.status(404).json({ message: 'Service not found or unavailable' });
        }

        if (quantity < service.minOrder || quantity > service.maxOrder) {
            return res.status(400).json({
                message: `Quantity must be between ${service.minOrder} and ${service.maxOrder}`
            });
        }

        // Run rate + provider lookup in parallel
        const [usdToNgn, provider] = await Promise.all([
            getNgnRate(),
            SMMProvider.findOne({ isActive: true }).lean(),
        ]);

        if (!provider) throw new Error('No active provider available');

        const ngnPer1000 = service.customPrice * usdToNgn;
        const amount     = parseFloat(((ngnPer1000 / 1000) * quantity).toFixed(2));

        await debitWallet(req.user._id, amount, `Boost - ${service.name}`);

        const providerRes = await axios.post(provider.apiUrl, {
            key:      provider.apiKey,
            action:   'add',
            service:  service.serviceId,
            link,
            quantity,
        });

        if (!providerRes.data?.order) throw new Error('Provider failed to process order');

        const order = await BoostOrder.create({
            user:            req.user._id,
            service:         service._id,
            link,
            quantity,
            amount,
            providerOrderId: providerRes.data.order,
            status:          'processing',
        });

        res.status(200).json({ message: 'Order placed successfully', order });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET check single order status
const getOrderStatus = async (req, res) => {
    try {
        const order = await BoostOrder.findOne({ _id: req.params.id, user: req.user._id })
            .populate('service', 'name category');
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const provider = await SMMProvider.findOne({ isActive: true }).lean();
        if (provider && order.providerOrderId) {
            const statusRes = await axios.post(provider.apiUrl, {
                key:    provider.apiKey,
                action: 'status',
                order:  order.providerOrderId,
            });
            const s = statusRes.data;
            order.status     = s.status?.toLowerCase() || order.status;
            order.remains    = s.remains;
            order.startCount = s.start_count;
            await order.save();
        }

        res.status(200).json({ order });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET user's order history
const getMyOrders = async (req, res) => {
    try {
        const orders = await BoostOrder.find({ user: req.user._id })
            .populate('service', 'name category')
            .sort({ createdAt: -1 })
            .lean();
        res.status(200).json({ orders });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getPublicServices, placeOrder, getOrderStatus, getMyOrders, invalidateServicesCache };
