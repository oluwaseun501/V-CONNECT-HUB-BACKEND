const BoostOrder = require('../models/BoostOrder');
const SMMProvider = require('../models/SMMProvider');
const {
    cancelProviderOrder,
    providerRequest,
    isProviderUnavailable,
    normalizeProviderStatus,
} = require('../services/smmProviderApi');
const {
    refundBoostOrder,
} = require('../services/smmRefundService');
const {
    applyProviderStatus,
    publicOrder,
} = require('./boostingController');

const ACTIVE_STATUSES = ['pending', 'processing'];

async function getAdminBoostOrders(req, res) {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
        const filter = {};

        if (req.query.status) filter.status = String(req.query.status).toLowerCase();
        if (req.query.search) {
            const search = String(req.query.search).trim();
            filter.$or = [
                { link: { $regex: search, $options: 'i' } },
                { providerOrderId: { $regex: search, $options: 'i' } },
            ];
        }

        const [orders, total] = await Promise.all([
            BoostOrder.find(filter)
                .populate('user', 'name email')
                .populate('service', 'name category canCancel')
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            BoostOrder.countDocuments(filter),
        ]);

        return res.status(200).json({
            orders: orders.map(publicOrder),
            total,
            page,
            pages: Math.max(Math.ceil(total / limit), 1),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Unable to load boost orders' });
    }
}

async function refreshAdminBoostOrder(req, res) {
    try {
        const order = await BoostOrder.findById(req.params.id)
            .populate('service', 'name category canCancel');

        if (!order) return res.status(404).json({ message: 'Boost order not found' });
        if (!order.providerOrderId) {
            return res.status(400).json({
                message: 'This order has no provider order ID to check.',
            });
        }

        const provider = order.provider
            ? await SMMProvider.findById(order.provider).lean()
            : await SMMProvider.findOne({ isActive: true }).lean();

        if (!provider) {
            return res.status(503).json({
                message: 'No provider is available for this order.',
            });
        }

        const response = await providerRequest(provider, {
            key: provider.apiKey,
            action: 'status',
            order: order.providerOrderId,
        });

        if (isProviderUnavailable(response) || response.data?.error) {
            return res.status(502).json({
                message: 'Provider status is temporarily unavailable.',
            });
        }

        await applyProviderStatus(order, response.data);
        return res.status(200).json({
            message: 'Provider status refreshed',
            order: publicOrder(order),
        });
    } catch (error) {
        return res.status(500).json({ message: 'Unable to refresh boost order' });
    }
}

async function cancelAdminBoostOrder(req, res) {
    try {
        const order = await BoostOrder.findById(req.params.id)
            .populate('service', 'name category canCancel');

        if (!order) return res.status(404).json({ message: 'Boost order not found' });
        if (!ACTIVE_STATUSES.includes(order.status)) {
            return res.status(400).json({
                message: `Order cannot be cancelled while it is ${order.status}.`,
            });
        }
        if (!order.providerOrderId) {
            return res.status(400).json({
                message: 'This order has not received a provider order ID yet.',
            });
        }

        const provider = order.provider
            ? await SMMProvider.findById(order.provider).lean()
            : await SMMProvider.findOne({ isActive: true }).lean();

        if (!provider) {
            return res.status(503).json({
                message: 'No provider is available for this order.',
            });
        }

        order.cancelRequestedAt = new Date();
        order.cancellationSource = 'admin';
        await order.save();

        let result;
        try {
            result = await cancelProviderOrder(provider, order.providerOrderId);
        } catch (error) {
            return res.status(202).json({
                message: 'Cancellation request is pending provider confirmation.',
                order: publicOrder(order),
            });
        }

        if (!result.accepted) {
            order.cancelRequestedAt = null;
            await order.save();
            return res.status(409).json({
                message: 'The provider did not accept cancellation.',
            });
        }

        order.status = 'cancelled';
        await order.save();
        await refundBoostOrder(order._id, 'Refund - Admin cancelled boost order');
        await order.populate('user', 'name email');

        return res.status(200).json({
            message: 'Boost order cancelled and refunded.',
            order: publicOrder(order),
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Unable to cancel boost order',
        });
    }
}

module.exports = {
    getAdminBoostOrders,
    refreshAdminBoostOrder,
    cancelAdminBoostOrder,
};