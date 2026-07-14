const SMMService = require('../models/SMMService');
const SMMProvider = require('../models/SMMProvider');
const BoostOrder = require('../models/BoostOrder');
const { debitWallet } = require('../services/walletService');
const axios = require('axios');

// GET all enabled services (what customers see)
const getPublicServices = async (req, res) => {
    try {
        const services = await SMMService.find({ isEnabled: true })
            .select('serviceId name category customPrice minOrder maxOrder')
            .sort({ category: 1 });
        res.status(200).json(services);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST place an order
const placeOrder = async (req, res) => {
    try {
        const { serviceId, link, quantity } = req.body;

        if (!serviceId || !link || !quantity) {
            return res.status(400).json({ message: 'serviceId, link and quantity are required' });
        }

        const service = await SMMService.findById(serviceId);
        if (!service || !service.isEnabled) {
            return res.status(404).json({ message: 'Service not found or unavailable' });
        }

        if (quantity < service.minOrder || quantity > service.maxOrder) {
            return res.status(400).json({
                message: `Quantity must be between ${service.minOrder} and ${service.maxOrder}`
            });
        }

        // Calculate cost (customPrice is per 1000)
        const amount = parseFloat(((service.customPrice / 1000) * quantity).toFixed(2));

        // Deduct from wallet
        await debitWallet(req.user._id, amount, `Boost - ${service.name}`);

        // Get active provider
        const provider = await SMMProvider.findOne({ isActive: true });
        if (!provider) throw new Error('No active provider available');

        // Place with provider
        const providerRes = await axios.post(provider.apiUrl, {
            key: provider.apiKey,
            action: 'add',
            service: service.serviceId,
            link,
            quantity
        });

        if (!providerRes.data?.order) throw new Error('Provider failed to process order');

        const order = await BoostOrder.create({
            user: req.user._id,
            service: service._id,
            link,
            quantity,
            amount,
            providerOrderId: providerRes.data.order,
            status: 'processing'
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

        const provider = await SMMProvider.findOne({ isActive: true });
        if (provider && order.providerOrderId) {
            const statusRes = await axios.post(provider.apiUrl, {
                key: provider.apiKey,
                action: 'status',
                order: order.providerOrderId
            });
            const s = statusRes.data;
            order.status = s.status?.toLowerCase() || order.status;
            order.remains = s.remains;
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
            .sort({ createdAt: -1 });
        res.status(200).json({ orders });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getPublicServices, placeOrder, getOrderStatus, getMyOrders };