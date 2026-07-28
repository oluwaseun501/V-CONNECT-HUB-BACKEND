const VirtualOrder  = require('../models/VirtualOrder');
const Provider      = require('../models/Provider');
const PriceOverride = require('../models/PriceOverride');
const SiteConfig    = require('../models/SiteConfig');
const { debitWallet, creditWallet } = require('../services/walletService');
const {
    getAvailableCountries,
    getAvailableProducts,
    purchaseNumber,
    checkOrder,
    cancelOrder,
    finishOrder
} = require('../services/fivesimService');

const listCountries = async (req, res) => {
    try {
        const countries = await getAvailableCountries();
        res.status(200).json(countries);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const listProducts = async (req, res) => {
    try {
        const { country, operator = 'virtual' } = req.params;

        const provider      = await Provider.findOne({ isActive: true });
        const markupPercent = provider?.markupPercent ?? 0;

        const siteConfig = await SiteConfig.findOne();
        const usdToNgn   = siteConfig?.usdToNgn ?? 1600;

        const overrides = await PriceOverride.find({ country: country.toLowerCase() });
        const overrideMap = {};
        overrides.forEach(o => { overrideMap[o.service] = o.price; });

        const products = await getAvailableProducts(country, operator);

        const normalized = {};
        for (const [service, operators] of Object.entries(products)) {
            if (!operators || typeof operators !== 'object') continue;
            normalized[service] = {};
            for (const [op, data] of Object.entries(operators)) {
                const rawPrice = data?.Price ?? data?.price ?? data?.cost ?? 0;

                const finalPrice = overrideMap[service.toLowerCase()] != null
                    ? overrideMap[service.toLowerCase()]
                    : parseFloat((rawPrice * usdToNgn * (1 + markupPercent / 100)).toFixed(2));

                normalized[service][op] = { ...data, Price: finalPrice };
            }
        }

        res.status(200).json(normalized);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const buyNumber = async (req, res) => {
    try {
        const { country, operator = 'virtual', product } = req.body;
        if (!country || !product) {
            return res.status(400).json({ message: 'country and product are required' });
        }

        const provider      = await Provider.findOne({ isActive: true });
        const markupPercent = provider?.markupPercent ?? 0;

        const siteConfig = await SiteConfig.findOne();
        const usdToNgn   = siteConfig?.usdToNgn ?? 1600;

        // Reserve the number from 5sim
        const orderData = await purchaseNumber(country, operator, product);
        const basePrice = orderData.price ?? orderData.Price ?? 0;

        // What this number actually costs us in NGN (no markup)
        const providerCostNgn = parseFloat((basePrice * usdToNgn).toFixed(2));

        // Check for a price override
        const override = await PriceOverride.findOne({
            service: product.toLowerCase(),
            country: country.toLowerCase()
        });

        const finalPrice = override
            ? override.price
            : parseFloat((basePrice * usdToNgn * (1 + markupPercent / 100)).toFixed(2));

        // ── GUARD: enforce minimum margin ────────────────────────────────────
        // The minimum acceptable price = provider cost + your full markup %.
        // This blocks both loss-making purchases AND price overrides that
        // undercut your configured profit margin.
        const minimumPrice = parseFloat((providerCostNgn * (1 + markupPercent / 100)).toFixed(2));

        if (finalPrice < minimumPrice) {
            try { await cancelOrder(orderData.id); } catch (_) {}
            console.warn(
                `[buyNumber] GUARD blocked: finalPrice ₦${finalPrice} < ` +
                `minimumPrice ₦${minimumPrice} (providerCost ₦${providerCostNgn} + ${markupPercent}% markup) ` +
                `[${product}/${country}]`
            );
            return res.status(400).json({
                message: 'This service is temporarily unavailable. Please contact support.'
            });
        }
        // ─────────────────────────────────────────────────────────────────────

        await debitWallet(req.user._id, finalPrice, `Virtual number — ${product} (${country})`);

        const order = await VirtualOrder.create({
            user:      req.user._id,
            orderId:   orderData.id,
            phone:     orderData.phone,
            country,
            operator:  orderData.operator,
            product,
            price:     finalPrice,
            status:    orderData.status?.toUpperCase() || 'PENDING',
            expiresAt: orderData.expires ? new Date(orderData.expires) : undefined
        });

        res.status(201).json({ message: 'Number purchased successfully', order });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const checkSms = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await VirtualOrder.findOne({ orderId: Number(orderId), user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const result = await checkOrder(Number(orderId));
        order.status = result.status?.toUpperCase() || order.status;
        if (result.sms?.length) order.sms = result.sms;
        await order.save();

        res.status(200).json({ orderId: order.orderId, phone: order.phone, status: order.status, sms: order.sms });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const cancelNumberOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await VirtualOrder.findOne({ orderId: Number(orderId), user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const liveOrder  = await checkOrder(Number(orderId));
        const liveStatus = liveOrder.status?.toUpperCase();
        order.status     = liveStatus || order.status;
        if (liveOrder.sms?.length) order.sms = liveOrder.sms;
        await order.save();

        if (order.status !== 'PENDING') {
            return res.status(400).json({ message: 'Cannot cancel — SMS already received or order no longer pending' });
        }

        await cancelOrder(Number(orderId));
        order.status = 'CANCELED';
        await order.save();

        await creditWallet(req.user._id, order.price, `Refund — cancelled number (${order.product})`);

        res.status(200).json({ message: 'Order cancelled and refunded', orderId: order.orderId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const finishNumberOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await VirtualOrder.findOne({ orderId: Number(orderId), user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        await finishOrder(Number(orderId));
        order.status = 'FINISHED';
        await order.save();
        res.status(200).json({ message: 'Order finished', orderId: order.orderId });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getMyOrders = async (req, res) => {
    try {
        const page   = parseInt(req.query.page)  || 1;
        const limit  = parseInt(req.query.limit) || 20;
        const skip   = (page - 1) * limit;
        const orders = await VirtualOrder.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit);
        const total  = await VirtualOrder.countDocuments({ user: req.user._id });
        res.status(200).json({ orders, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getOrderById = async (req, res) => {
    try {
        const order = await VirtualOrder.findOne({ _id: req.params.id, user: req.user._id });
        if (!order) return res.status(404).json({ message: 'Order not found' });
        res.status(200).json(order);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { listCountries, listProducts, buyNumber, checkSms, cancelNumberOrder, finishNumberOrder, getMyOrders, getOrderById };
