// Boosting order controller
//
// This is the backend file used by:
//   GET  /boost/services
//   GET  /boost/orders
//   POST /boost/order
//   GET  /boost/orders/:id
//
// The boosting page already sends the transaction PIN in the
// x-transaction-pin header. This controller validates that PIN, protects the
// wallet, checks the active SMM provider, and submits form-encoded requests.

const SMMService = require('../models/SMMService');
const SMMProvider = require('../models/SMMProvider');
const BoostOrder = require('../models/BoostOrder');
const SiteConfig = require('../models/SiteConfig');
const User = require('../models/User');
const { debitWallet, creditWallet } = require('../services/walletService');
const axios = require('axios');

let servicesCache = null;
let servicesCacheAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30 * 1000;
const DUPLICATE_ORDER_WINDOW_MS = 5 * 60 * 1000;

class ProviderRejectedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProviderRejectedError';
    }
}

class ProviderUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProviderUnavailableError';
    }
}

function invalidateServicesCache() {
    servicesCache = null;
    servicesCacheAt = 0;
}

async function getNgnRate() {
    const siteConfig = await SiteConfig.findOne();
    const rate = Number(siteConfig?.usdToNgn ?? 1600);

    if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Invalid NGN exchange rate configuration');
    }

    return rate;
}

function getProviderError(data) {
    if (!data) return 'Provider rejected the request';
    if (typeof data === 'string') return data;
    return data.error || data.message || 'Provider rejected the request';
}

function providerRequest(provider, values) {
    const form = new URLSearchParams();

    for (const [key, value] of Object.entries(values)) {
        form.append(key, String(value));
    }

    return axios.post(provider.apiUrl, form, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: PROVIDER_TIMEOUT_MS,
        // We inspect the provider response ourselves so provider error bodies
        // are handled consistently.
        validateStatus: () => true,
    });
}

function hasProviderOrder(data) {
    return data?.order !== undefined &&
        data?.order !== null &&
        String(data.order).trim() !== '';
}

function normalizeStatus(status) {
    const value = String(status || '').toLowerCase();
    return value === 'canceled' ? 'cancelled' : value;
}

async function checkProviderBalance(provider, service, quantity) {
    const response = await providerRequest(provider, {
        key: provider.apiKey,
        action: 'balance',
    });

    if (response.status >= 500) {
        throw new ProviderUnavailableError('Provider balance endpoint is unavailable');
    }

    const balance = Number(response.data?.balance);
    if (response.data?.error || !Number.isFinite(balance)) {
        throw new ProviderRejectedError(getProviderError(response.data));
    }

    const providerPrice = Number(service.providerPrice);
    const providerCost = (providerPrice / 1000) * quantity;

    if (!Number.isFinite(providerPrice) || providerPrice < 0) {
        throw new ProviderUnavailableError('Provider service price is not configured');
    }

    if (balance < providerCost) {
        throw new ProviderRejectedError('Provider balance is too low');
    }
}

// GET all enabled services — prices returned in NGN
const getPublicServices = async (req, res) => {
    try {
        if (servicesCache && Date.now() - servicesCacheAt < CACHE_TTL_MS) {
            return res.status(200).json(servicesCache);
        }

        const [usdToNgn, services] = await Promise.all([
            getNgnRate(),
            SMMService.find({ isEnabled: true })
                .select('serviceId name category customPrice providerPrice minOrder maxOrder')
                .sort({ category: 1 })
                .lean(),
        ]);

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
                    ngnPrice: Number((pricePerThousand * usdToNgn).toFixed(2)),
                };
            })
            .filter((service) => Number.isFinite(service.ngnPrice));

        servicesCache = publicServices;
        servicesCacheAt = Date.now();

        return res.status(200).json(publicServices);
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
};

// POST place an order
const placeOrder = async (req, res) => {
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

        // This is the server-side PIN check. The frontend PIN field alone is
        // not security; every order must be checked here.
        if (!/^\d{4}$/.test(pin)) {
            return res.status(401).json({
                message: 'Enter your 4-digit transaction PIN',
            });
        }

        if (!req.user?.transactionPin ||
            pin !== String(req.user.transactionPin)) {
            return res.status(401).json({
                message: 'Invalid transaction PIN',
            });
        }

        const service = await SMMService.findById(serviceId).lean();
        if (!service || !service.isEnabled) {
            return res.status(404).json({
                message: 'Service not found or unavailable',
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

        const [usdToNgn, provider] = await Promise.all([
            getNgnRate(),
            SMMProvider.findOne({ isActive: true }).lean(),
        ]);

        if (!provider) {
            return res.status(503).json({
                message: 'Boost services are temporarily unavailable. Please try again later.',
            });
        }

        // Do not send a service synced from another provider to the active
        // provider.
        if (!service.provider ||
            String(service.provider) !== String(provider._id)) {
            return res.status(503).json({
                message: 'This service is not available from the active provider.',
            });
        }

        const pricePerThousand = Number(
            service.customPrice ?? service.providerPrice
        );
        if (!Number.isFinite(pricePerThousand) || pricePerThousand < 0) {
            return res.status(503).json({
                message: 'This service is not correctly configured.',
            });
        }

        amount = Number(
            ((pricePerThousand * usdToNgn / 1000) * parsedQuantity).toFixed(2)
        );

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({
                message: 'Unable to calculate the order charge',
            });
        }

        // Stop accidental double-clicks or repeated requests from creating
        // duplicate provider orders.
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

        // Make sure the provider has funds before reserving the customer's
        // money.
        try {
            await checkProviderBalance(provider, service, parsedQuantity);
        } catch (error) {
            if (error instanceof ProviderRejectedError) {
                return res.status(503).json({
                    message: 'The boosting provider is currently unavailable. Please try again later.',
                });
            }
            throw error;
        }

        // debitWallet performs an atomic "balance >= amount" update.
        await debitWallet(req.user._id, amount, `Boost - ${service.name}`);

        try {
            order = await BoostOrder.create({
                user: req.user._id,
                service: service._id,
                link: link.trim(),
                quantity: parsedQuantity,
                amount,
                status: 'pending',
            });
        } catch (error) {
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
            // A timeout may happen after the provider accepted the order.
            // Keep it pending rather than refunding and risking a duplicate.
            return res.status(202).json({
                message: 'Order is pending provider confirmation. Please check My Orders shortly.',
                order,
            });
        }

        if (providerResponse.status >= 500) {
            return res.status(202).json({
                message: 'Order is pending provider confirmation. Please check My Orders shortly.',
                order,
            });
        }

        if (!hasProviderOrder(providerResponse.data)) {
            const providerMessage = getProviderError(providerResponse.data);

            await creditWallet(
                req.user._id,
                amount,
                'Refund - Boost order rejected'
            );

            order.status = 'failed';
            await order.save();

            return res.status(503).json({
                message: providerMessage.toLowerCase().includes('balance')
                    ? 'The boosting provider is currently out of funds. Please try again later.'
                    : 'The provider rejected this order. Your wallet has been refunded.',
            });
        }

        order.providerOrderId = String(providerResponse.data.order);
        order.status = 'processing';
        await order.save();

        const updatedUser = await User.findById(req.user._id)
            .select('balance')
            .lean();

        return res.status(201).json({
            message: 'Order placed successfully',
            order,
            balance: updatedUser?.balance,
        });
    } catch (error) {
        if (error?.message === 'Insufficient wallet balance') {
            return res.status(402).json({
                message: 'Insufficient wallet balance for this order.',
            });
        }

        if (error instanceof ProviderUnavailableError) {
            return res.status(503).json({
                message: 'The boosting provider is temporarily unavailable. Please try again later.',
            });
        }

        console.error('[boost] Order placement error:', error);
        return res.status(500).json({
            message: 'Unable to place the order right now. Please try again.',
        });
    }
};

// GET check single order status
const getOrderStatus = async (req, res) => {
    try {
        const order = await BoostOrder.findOne({
            _id: req.params.id,
            user: req.user._id,
        }).populate('service', 'name category');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const provider = await SMMProvider.findOne({ isActive: true }).lean();
        if (provider && order.providerOrderId) {
            const response = await providerRequest(provider, {
                key: provider.apiKey,
                action: 'status',
                order: order.providerOrderId,
            });

            if (response.status >= 500 || response.data?.error) {
                return res.status(502).json({
                    message: 'Provider status is temporarily unavailable.',
                });
            }

            const status = normalizeStatus(response.data?.status);
            if (status) order.status = status;
            if (response.data?.remains !== undefined) {
                order.remains = response.data.remains;
            }
            if (response.data?.start_count !== undefined) {
                order.startCount = response.data.start_count;
            }
            await order.save();
        }

        return res.status(200).json({ order });
    } catch (error) {
        return res.status(500).json({
            message: 'Unable to load order status',
        });
    }
};

// GET user's order history
const getMyOrders = async (req, res) => {
    try {
        const orders = await BoostOrder.find({ user: req.user._id })
            .populate('service', 'name category')
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({ orders });
    } catch (error) {
        return res.status(500).json({
            message: 'Unable to load order history',
        });
    }
};

module.exports = {
    getPublicServices,
    placeOrder,
    getOrderStatus,
    getMyOrders,
    invalidateServicesCache,
};