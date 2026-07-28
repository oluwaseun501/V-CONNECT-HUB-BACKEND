// controllers/boostingController.js

const SMMService  = require('../models/SMMService');
const SMMProvider = require('../models/SMMProvider');
const BoostOrder  = require('../models/BoostOrder');
const SiteConfig  = require('../models/SiteConfig');
const { debitWallet } = require('../services/walletService');
const axios = require('axios');

// ─── Simple in-memory cache (5 min TTL) ──────────────────────────────────────
let _servicesCache = null;
let _servicesCacheAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

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
        if (_servicesCache && Date.now() - _servicesCacheAt < CACHE_TTL_MS) {
            return res.status(200).json(_servicesCache);
        }

        const [usdToNgn, services] = await Promise.all([
            getNgnRate(),
            SMMService.find({ isEnabled: true })
                .select('serviceId name category customPrice minOrder maxOrder')
                .sort({ category: 1 })
                .lean(),
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

        _servicesCache = withNgn;
        _servicesCacheAt = Date.now();

        res.status(200).json(withNgn);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST place an order
// ── KEY FIX: provider is called FIRST — user is only debited if it succeeds ──
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

        const [usdToNgn, provider] = await Promise.all([
            getNgnRate(),
            SMMProvider.findOne({ isActive: true }).lean(),
        ]);

        if (!provider) {
            return res.status(503).json({
                message: 'Boost services are temporarily unavailable. Please try again later.'
            });
        }

        const ngnPer1000 = service.customPrice * usdToNgn;
        const amount     = parseFloat(((ngnPer1000 / 1000) * quantity).toFixed(2));

        // ── STEP 1: Call provider FIRST — before touching the user's wallet ──
        let providerOrderId;
        try {
            const providerRes = await axios.post(provider.apiUrl, {
                key:      provider.apiKey,
                action:   'add',
                service:  service.serviceId,
                link,
                quantity,
            });

            if (!providerRes.data?.order) {
                // Provider returned a response but no order ID — likely unfunded or misconfigured
                const providerError = providerRes.data?.error || 'Provider could not process the order';
                console.error(`[boost] Provider rejected order: ${providerError}`);
                return res.status(503).json({
                    message: 'This service is temporarily unavailable. Please try again later.'
                });
            }

            providerOrderId = providerRes.data.order;

        } catch (providerErr) {
            // Network error or provider API down
            console.error(`[boost] Provider API error: ${providerErr.message}`);
            return res.status(503).json({
                message: 'Boost service is currently unavailable. Please try again later.'
            });
        }

        // ── STEP 2: Provider accepted — now debit the user's wallet ──────────
        await debitWallet(req.user._id, amount, `Boost - ${service.name}`);

        // ── STEP 3: Save the order ────────────────────────────────────────────
        const order = await BoostOrder.create({
            user:            req.user._id,
            service:         service._id,
            link,
            quantity,
            amount,
            providerOrderId: String(providerOrderId),
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
