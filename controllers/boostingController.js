const SMMService = require('../models/SMMService');
const SMMProvider = require('../models/SMMProvider');
const BoostOrder = require('../models/BoostOrder');
const SiteConfig = require('../models/SiteConfig');
const User = require('../models/User');
const bcrypt = require("bcryptjs");
const { debitWallet } = require('../services/walletService');
const { refundBoostOrder } = require('../services/smmRefundService');
const {
    providerRequest,
    getProviderError,
    isProviderUnavailable,
    hasProviderOrder,
    getProviderBalance,
    cancelProviderOrder,
    normalizeProviderStatus,
} = require('../services/smmProviderApi');
const {
    getCachedServices,
    setCachedServices,
} = require('../services/smmServicesCache');

const DUPLICATE_ORDER_WINDOW_MS = 5 * 60 * 1000;
const USER_CANCEL_WINDOW_MS = 2 * 60 * 1000;

function publicOrder(order) {
    const raw = typeof order.toObject === 'function' ? order.toObject() : { ...order };
    const quantity = Number(raw.quantity);
    const remains = Number(raw.remains);
    const progressPercent = Number.isFinite(Number(raw.progressPercent))
        ? Number(raw.progressPercent)
        : Number.isFinite(remains) && quantity > 0
            ? Math.min(100, Math.max(0, ((quantity - remains) / quantity) * 100))
            : null;

    return {
        ...raw,
        progressPercent: progressPercent === null
            ? null
            : Number(progressPercent.toFixed(2)),
        delivered: Number.isFinite(remains)
            ? Math.max(0, quantity - remains)
            : raw.delivered,
        canUserCancel: (
            ['pending', 'processing'].includes(String(raw.status)) &&
            raw.providerCanCancel === true &&
            Date.now() - new Date(raw.createdAt).getTime() <= USER_CANCEL_WINDOW_MS &&
            !raw.cancelRequestedAt &&
            !raw.refunded
        ),
    };
}

async function getNgnRate() {
    const siteConfig = await SiteConfig.findOne().lean();
    const rate = Number(siteConfig?.usdToNgn ?? 1600);

    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Invalid NGN exchange rate configuration');
    }

    return rate;
}

async function getActiveProvider() {
    return SMMProvider.findOne({ isActive: true }).lean();
}

async function getPublicServices(req, res) {
    try {
        const cached = getCachedServices();
        if (cached) return res.status(200).json(cached);

        const [usdToNgn, provider] = await Promise.all([
            getNgnRate(),
            getActiveProvider(),
        ]);

        if (!provider) {
            return res.status(503).json({
                message: 'Boost services are temporarily unavailable.',
            });
        }

        const services = await SMMService.find({
            provider: provider._id,
            isEnabled: true,
        })
            .select('serviceId name category customPrice providerPrice minOrder maxOrder canCancel')
            .sort({ category: 1, name: 1 })
            .lean();

        const publicServices = services
            .map((service) => {
                const pricePerThousand = Number(
                    service.customPrice ?? service.providerPrice
                );

                return {
                    _id: service._id,
                    serviceId: service.serviceId,
                    name: service.name,
                    category: service.category,
                    minOrder: service.minOrder,
                    maxOrder: service.maxOrder,
                    canCancel: service.canCancel === true,
                    ngnPrice: Number((pricePerThousand * usdToNgn).toFixed(2)),
                };
            })
            .filter((service) =>
                Number.isFinite(service.ngnPrice) &&
                service.ngnPrice > 0
            );

        setCachedServices(publicServices);
        return res.status(200).json(publicServices);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

async function placeOrder(req, res) {
    let order;
    let amount = 0;

    try {
        const { serviceId, link, quantity } = req.body;
        const pin = String(req.headers['x-transaction-pin'] || '').trim();
        const parsedQuantity = Number(quantity);

        if (!serviceId) {
            return res.status(400).json({ message: 'A service is required' });
        }

        if (typeof link !== 'string' || !link.trim()) {
            return res.status(400).json({ message: 'A valid link is required' });
        }

        if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
            return res.status(400).json({
                message: 'Quantity must be a positive whole number',
            });
        }

if (!/^\d{4}$/.test(pin)) {
    return res.status(400).json({
        message: "Enter your 4-digit transaction PIN",
        code: "INVALID_TRANSACTION_PIN",
    });
}

const storedPin = String(req.user?.transactionPin ?? "").trim();

if (!storedPin) {
    return res.status(400).json({
        message: "Please set a transaction PIN before placing an order",
        code: "TRANSACTION_PIN_NOT_SET",
    });
}

const pinMatches = await bcrypt.compare(pin, storedPin);

if (!pinMatches) {
    return res.status(400).json({
        message: "Invalid transaction PIN",
        code: "INVALID_TRANSACTION_PIN",
    });
}

        const [service, usdToNgn, provider] = await Promise.all([
            SMMService.findById(serviceId).lean(),
            getNgnRate(),
            getActiveProvider(),
        ]);

        if (!service || !service.isEnabled) {
            return res.status(404).json({
                message: 'Service not found or unavailable',
            });
        }

        if (!provider) {
            return res.status(503).json({
                message: 'Boost services are temporarily unavailable. Please try again later.',
            });
        }

        if (String(service.provider) !== String(provider._id)) {
            return res.status(503).json({
                message: 'This service is no longer available. Please refresh and try again.',
            });
        }

        const minOrder = Number(service.minOrder);
        const maxOrder = Number(service.maxOrder);
        if (
            !Number.isInteger(minOrder) ||
            !Number.isInteger(maxOrder) ||
            parsedQuantity < minOrder ||
            parsedQuantity > maxOrder
        ) {
            return res.status(400).json({
                message: `Quantity must be between ${minOrder.toLocaleString()} and ${maxOrder.toLocaleString()}`,
            });
        }

        const providerPrice = Number(service.providerPrice);
        const pricePerThousand = Number(
            service.customPrice ?? service.providerPrice
        );
        const providerCost = (providerPrice / 1000) * parsedQuantity;

        if (!Number.isFinite(providerPrice) || providerPrice <= 0 ||
            !Number.isFinite(pricePerThousand) || pricePerThousand <= 0) {
            return res.status(503).json({
                message: 'This service is temporarily unavailable. Please try again later.',
            });
        }

        const duplicate = await BoostOrder.findOne({
            user: req.user._id,
            service: service._id,
            link: link.trim(),
            quantity: parsedQuantity,
            status: { $in: ['pending', 'processing'] },
            createdAt: {
                $gte: new Date(Date.now() - DUPLICATE_ORDER_WINDOW_MS),
            },
        }).lean();

        if (duplicate) {
            return res.status(409).json({
                message: 'This order is already being processed.',
                orderId: duplicate._id,
            });
        }

        try {
            const providerBalance = await getProviderBalance(provider);
            if (providerBalance.balance < providerCost) {
                return res.status(503).json({
                    message: 'This service is temporarily unavailable. Please try again later.',
                });
            }
        } catch (error) {
            if (error.code === 'PROVIDER_REJECTED' ||
                error.code === 'PROVIDER_UNAVAILABLE') {
                return res.status(503).json({
                    message: 'This service is temporarily unavailable. Please try again later.',
                });
            }
            throw error;
        }

        amount = Number(
            ((pricePerThousand * usdToNgn / 1000) * parsedQuantity).toFixed(2)
        );

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                message: 'Unable to calculate the order charge',
            });
        }

        await debitWallet(req.user._id, amount, `Boost - ${service.name}`);

        try {
            order = await BoostOrder.create({
                user: req.user._id,
                provider: provider._id,
                service: service._id,
                link: link.trim(),
                quantity: parsedQuantity,
                amount,
                providerCanCancel: service.canCancel === true,
                status: 'pending',
            });
        } catch (error) {
            // There is no provider order yet, so a direct refund is safe.
            const { creditWallet } = require('../services/walletService');
            await creditWallet(
                req.user._id,
                amount,
                'Refund - Boost order could not be created'
            );
            throw error;
        }

        let providerResponse;
        try {
            providerResponse = await providerRequest(provider, {
                key: provider.apiKey,
                action: 'add',
                service: service.serviceId,
                link: link.trim(),
                quantity: parsedQuantity,
            });
        } catch (error) {
            // The provider might have accepted the request before the timeout.
            // Keep it pending and let an admin review/reconcile it.
            return res.status(202).json({
                message: 'Order is pending provider confirmation. Please check My Orders shortly.',
                order: publicOrder(order),
            });
        }

        if (isProviderUnavailable(providerResponse)) {
            return res.status(202).json({
                message: 'Order is pending provider confirmation. Please check My Orders shortly.',
                order: publicOrder(order),
            });
        }

        if (!hasProviderOrder(providerResponse.data)) {
            const providerMessage = getProviderError(providerResponse.data);
            order.status = 'failed';
            await order.save();
            await refundBoostOrder(order._id, 'Refund - Boost order rejected');

            return res.status(503).json({
                message: providerMessage.toLowerCase().includes('balance')
                    ? 'This service is temporarily unavailable. Please try again later.'
                    : 'The provider rejected this order. Your wallet has been refunded.',
            });
        }

        order.providerOrderId = String(providerResponse.data.order);
        order.status = 'processing';
        order.lastStatusCheckAt = new Date();
        await order.save();

        const updatedUser = await User.findById(req.user._id)
            .select('balance')
            .lean();

        return res.status(201).json({
            message: 'Order placed successfully',
            order: publicOrder(order),
            balance: updatedUser?.balance,
        });
    } catch (error) {
        if (error?.message === 'Insufficient wallet balance') {
            return res.status(402).json({
                message: 'Insufficient wallet balance for this order.',
            });
        }

        return res.status(500).json({
            message: 'Unable to place the order right now. Please try again.',
        });
    }
}

async function applyProviderStatus(order, data) {
    const normalized = normalizeProviderStatus(data?.status);
    const remains = data?.remains === undefined
        ? order.remains
        : Number(data.remains);
    const startCount = data?.start_count === undefined
        ? order.startCount
        : Number(data.start_count);
    const delivered = Number.isFinite(Number(remains))
        ? Math.max(0, order.quantity - Number(remains))
        : order.delivered;
    const progressPercent = Number.isFinite(Number(remains)) && order.quantity > 0
        ? Math.min(100, Math.max(0, ((order.quantity - Number(remains)) / order.quantity) * 100))
        : normalized === 'completed'
            ? 100
            : order.progressPercent;

    if (normalized) order.status = normalized;
    if (Number.isFinite(Number(remains))) order.remains = Number(remains);
    if (Number.isFinite(Number(startCount))) order.startCount = Number(startCount);
    if (Number.isFinite(Number(delivered))) order.delivered = delivered;
    if (Number.isFinite(Number(progressPercent))) {
        order.progressPercent = Number(progressPercent.toFixed(2));
    }
    if (data?.charge !== undefined) order.providerCharge = Number(data.charge);
    if (data?.currency) order.providerCurrency = data.currency;
    order.lastProviderStatus = data?.status;
    order.lastStatusCheckAt = new Date();

    await order.save();

    if (['cancelled', 'failed'].includes(order.status) && !order.refunded) {
        await refundBoostOrder(
            order._id,
            `Refund - Boost order ${order.status}`
        );
    }

    return order;
}

async function getOrderStatus(req, res) {
    try {
        const order = await BoostOrder.findOne({
            _id: req.params.id,
            user: req.user._id,
        }).populate('service', 'name category');

        if (!order) return res.status(404).json({ message: 'Order not found' });

        const provider = order.provider
            ? await SMMProvider.findById(order.provider).lean()
            : await getActiveProvider();

        if (provider && order.providerOrderId &&
            ['pending', 'processing'].includes(order.status)) {
            const response = await providerRequest(provider, {
                key: provider.apiKey,
                action: 'status',
                order: order.providerOrderId,
            });

            if (!isProviderUnavailable(response) && !response.data?.error) {
                await applyProviderStatus(order, response.data);
            }
        }

        return res.status(200).json({ order: publicOrder(order) });
    } catch (error) {
        return res.status(500).json({ message: 'Unable to load order status' });
    }
}

async function getMyOrders(req, res) {
    try {
        const orders = await BoostOrder.find({ user: req.user._id })
            .populate('service', 'name category')
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({ orders: orders.map(publicOrder) });
    } catch (error) {
        return res.status(500).json({ message: 'Unable to load order history' });
    }
}

async function cancelMyOrder(req, res) {
    try {
        const order = await BoostOrder.findOne({
            _id: req.params.id,
            user: req.user._id,
        }).populate('service', 'name canCancel');

        if (!order) return res.status(404).json({ message: 'Order not found' });

        const age = Date.now() - new Date(order.createdAt).getTime();
        if (age > USER_CANCEL_WINDOW_MS) {
            return res.status(400).json({
                message: 'This order can no longer be cancelled.',
            });
        }

        if (!order.providerCanCancel || !order.providerOrderId) {
            return res.status(400).json({
                message: 'This service cannot be cancelled at this stage.',
            });
        }

        if (!['pending', 'processing'].includes(order.status) || order.refunded) {
            return res.status(400).json({
                message: 'This order can no longer be cancelled.',
            });
        }

        const provider = await SMMProvider.findById(order.provider).lean();
        if (!provider) {
            return res.status(503).json({
                message: 'The boosting provider is temporarily unavailable.',
            });
        }

        order.cancelRequestedAt = new Date();
        order.cancellationSource = 'user';
        await order.save();

        let result;
        try {
            result = await cancelProviderOrder(provider, order.providerOrderId);
        } catch (error) {
            return res.status(202).json({
                message: 'Cancellation is pending provider confirmation.',
                order: publicOrder(order),
            });
        }

        if (!result.accepted) {
            order.cancelRequestedAt = undefined;
            await order.save();
            return res.status(409).json({
                message: 'The provider could not cancel this order.',
            });
        }

        order.status = 'cancelled';
        await order.save();
        await refundBoostOrder(order._id, 'Refund - Customer cancelled boost order');

        await order.populate('service', 'name category');
        return res.status(200).json({
            message: 'Order cancelled and refunded.',
            order: publicOrder(order),
        });
    } catch (error) {
        return res.status(500).json({
            message: 'Unable to cancel this order right now.',
        });
    }
}

module.exports = {
    getPublicServices,
    placeOrder,
    getOrderStatus,
    getMyOrders,
    cancelMyOrder,
    applyProviderStatus,
    publicOrder,
    USER_CANCEL_WINDOW_MS,
};